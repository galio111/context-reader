import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { buildStudyPlan, planProgress, sanitizeStudySettings, scheduleStudy, STUDY_ALGORITHM, studyPaused, studyRating } from "@/lib/studyScheduler";
import { getStudySettings, getStudySnapshot, reconcileStudyCards, saveStudySettings, studyRpc } from "@/lib/studyStore";
import type { StudyAnswer, StudyCard } from "@/types/study";
import { recordServerError } from "@/lib/serverErrorReporting";

export const dynamic = "force-dynamic";
class StudyError extends Error { constructor(message: string, public status = 400, public code = "") { super(message); } }
async function owner(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) throw new StudyError("登录后即可开始复习。", 401);
  const expected = request.headers.get("X-Context-Account");
  if (expected && expected !== user.id) throw new StudyError("账号已切换，请刷新后继续。", 409);
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (!origin || origin !== requestExternalOrigin(request)) throw new StudyError("请在本站完成学习操作。", 403);
  }
  const profiles = await accountFetch<Array<{status: string}>>("account_profiles?user_id=eq." + encodeURIComponent(user.id) + "&select=status&limit=1");
  if (profiles[0]?.status !== "active") throw new StudyError("此账号暂时无法使用复习服务。", 403);
  return user.id;
}
function result(data: unknown) { return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }); }
async function failure(error: unknown,request:Request) {
  if (error instanceof StudyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
  console.error("[study]", error instanceof Error ? error.message : "unknown");
  await recordServerError(request,{category:"service",operation:"vocabulary_study",endpoint:"/api/study",userMessage:"学习记录暂时无法读取或保存。",httpStatus:503},error);
  return NextResponse.json({ error: "学习记录暂时无法读取或保存，请稍后重试。进度不会被自动重置。" }, { status: 503 });
}
export async function GET(request: Request) {
  try { return result(await getStudySnapshot(await owner(request))); } catch (error) { return failure(error,request); }
}
export async function POST(request: Request) {
  try {
    const userId = await owner(request);
    let body: Record<string, unknown>;
    try { body = await readJsonBody<Record<string, unknown>>(request, 8192); } catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw error;
      throw new StudyError("请求格式不正确。");
    }
    const op = body.op;
    if (op === "prepare") {await reconcileStudyCards(userId);return result(await getStudySnapshot(userId));}
    if (op === "start") {
      await reconcileStudyCards(userId);
      const snapshot = await getStudySnapshot(userId);
      if (studyPaused(snapshot.settings, new Date())) throw new StudyError("当前已暂停。恢复学习后即可继续。", 409);
      const ids = buildStudyPlan(snapshot.cards, snapshot.settings, new Date());
      if (!snapshot.today && ids.length) await studyRpc("start", { p_user: userId, p_ids: ids, p_settings: snapshot.settings });
      return result(await getStudySnapshot(userId));
    }
    if (op === "settings" || op === "pause" || op === "resume") {
      const current = await getStudySettings(userId);
      let next = current;
      if (op === "settings") {
        try { next = sanitizeStudySettings(body.settings, current); } catch (e) { throw new StudyError((e as Error).message); }
      } else if (op === "pause") {
        const days = Number(body.days);
        if (![1,3,7,14,30].includes(days)) throw new StudyError("请选择暂停天数。");
        next = { ...current, pausedUntil: new Date(Date.now() + days * 86400000).toISOString() };
      } else next = { ...current, pausedUntil: null };
      if(op==="pause")await studyRpc("pause",{p_user:userId,p_settings:next});
      else await saveStudySettings(userId, next);
      return result(await getStudySnapshot(userId));
    }
    const cardId = String(body.cardId ?? "");
    if(op==="activateMembership"){
      if(!Number.isSafeInteger(body.milestone))throw new StudyError("奖励记录无效。");
      const reward=await studyRpc<{activated?:boolean;existingPlan?:boolean}>("activate_membership",{p_user:userId,p_milestone:body.milestone});
      if(!reward.activated)throw new StudyError(reward.existingPlan?"你正在使用不同档位的会员。奖励已保留，可在当前会员到期后启用。":"没有可启用的会员奖励。",409);
      return result(await getStudySnapshot(userId));
    }
    if (op === "present" || op === "review") {
      if (!/^[a-f0-9]{40}$/.test(cardId) || !Number.isSafeInteger(body.version)) throw new StudyError("这张卡片已变化，请刷新学习记录。");
      const rows = await accountFetch<StudyCard[]>("study_cards?user_id=eq." + encodeURIComponent(userId) + "&id=eq." + cardId + "&limit=1");
      const card = rows[0];
      if (!card || card.suspended) throw new StudyError("这个词条已移除。", 404, "state_changed");
      if (op === "present") {
        const state = await studyRpc<Record<string,unknown>>("present", { p_user: userId, p_card: cardId, p_version: body.version });
        if (!state.token) throw new StudyError("这张卡片暂时不能作答，请刷新学习记录。", 409);
        return result(state);
      }
      const answer = body.answer as StudyAnswer;
      if (!["forgot","unsure_wrong","unsure_right","remembered"].includes(answer)) throw new StudyError("请选择本次回忆结果。");
      if (!/^[0-9a-f-]{36}$/i.test(String(body.id)) || !/^[0-9a-f-]{36}$/i.test(String(body.token))) throw new StudyError("本次答题凭据无效。");
      const settings = await getStudySettings(userId);
      const snapshot = await getStudySnapshot(userId);
      const retention = snapshot.today?.settings.retention ?? settings.retention;
      const scheduled = scheduleStudy(card.memory, answer, new Date(), retention);
      const saved = await studyRpc<Record<string,unknown>>("review", {
        p_user: userId, p_id: body.id, p_card: cardId, p_version: body.version, p_token: body.token,
        p_answer: answer, p_rating: studyRating(answer), p_active: Math.max(0, Math.min(60000, Math.floor(Number(body.activeMs) || 0))),
        p_memory: scheduled.memory, p_algorithm: STUDY_ALGORITHM, p_parameters: { retention, learningSteps: ["1m","10m"], relearningSteps: ["10m"], fuzz: false },
      });
      if (!saved.saved && !saved.duplicate) throw new StudyError(saved.tooFast ? "请先回忆并核对答案，再记录结果。" : "学习状态已变化，本次没有重复记分。已保留服务器上的最新进度。", 409, saved.tooFast ? "too_fast" : "state_changed");
      let updated=await getStudySnapshot(userId);
      const progress=planProgress(updated.cards,updated.today?.card_ids??[],new Date(),updated.today?.new_ids);
      if(progress.total>0&&progress.finished===progress.total&&!updated.today?.completed_at){
        await reconcileStudyCards(userId);
        await studyRpc("complete",{p_user:userId});updated=await getStudySnapshot(userId);
      }
      return result({ saved: true, id: body.id, snapshot: updated });
    }
    if (op === "undo") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.id))) throw new StudyError("记录无效。");
      const saved = await studyRpc<Record<string,unknown>>("undo", { p_user: userId, p_id: body.id });
      if (!saved.saved && !saved.duplicate) throw new StudyError(saved.settled?"当天计划已经结算，无法再撤销。":"仅能撤销十五分钟内、尚未再次作答的那次记录。", 409);
      return result(await getStudySnapshot(userId));
    }
    if (op === "complete") {
      await reconcileStudyCards(userId);
      const completion = await studyRpc("complete", { p_user: userId });
      return result({ completion, snapshot: await getStudySnapshot(userId) });
    }
    throw new StudyError("学习操作无效。");
  } catch (error) { return failure(error,request); }
}
