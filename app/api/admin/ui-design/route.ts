import { NextResponse } from "next/server";
import { getAdminAccessMode } from "@/lib/adminAuth";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { UiDesignValidationError } from "@/lib/uiDesign";
import { mutateUiDesign, readUiDesignState } from "@/lib/uiDesignStore";
import { invalidatePublishedDesign } from '@/lib/uiDesignPublished';

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }

export async function GET() {
  if (await getAdminAccessMode() !== "developer") return reply({ error: "仅管理员可调整网站设计。" }, 403);
  try { return reply({ state: await readUiDesignState() }); }
  catch (error) {
    console.error("UI design admin read failed", error);
    return reply({ error: "设计方案暂时无法读取，请稍后重试。" }, 503);
  }
}

export async function POST(request: Request) {
  if (await getAdminAccessMode() !== "developer") return reply({ error: "仅管理员可调整网站设计。" }, 403);
  if (request.headers.get("origin") !== requestExternalOrigin(request)
    || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "请在本站保存设计。" }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) return reply({ error: "设计方案格式无效。" }, 415);
  let body: unknown;
  try { body = await readJsonBody(request, 64 * 1024); }
  catch (error) { return reply({ error: error instanceof RequestBodyTooLargeError ? "设计方案过大，请减少同时调整的元素。" : "设计方案格式无效。" }, error instanceof RequestBodyTooLargeError ? 413 : 400); }
  try {
    const result = await mutateUiDesign(body);
    if (result.status === "conflict") return reply({ error: "方案已在另一处更新，请先重新载入。", code: "conflict", state: result.state }, 409);
    if (result.status === "no-previous") return reply({ error: "还没有可恢复的上一版设计。", code: "no-previous", state: result.state }, 409);
    if(result.status==='published'||result.status==='rolled-back')invalidatePublishedDesign();
    return reply({ state: result.state, status: result.status });
  } catch (error) {
    if (error instanceof UiDesignValidationError) return reply({ error: error.message }, 400);
    console.error("UI design mutation failed", error);
    return reply({ error: "暂时无法确认保存结果，请重新载入后重试。" }, 503);
  }
}
