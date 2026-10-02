import { billingRpc } from "@/lib/billingStore";
import { NextResponse } from "next/server";
import { finishUsage, getUsageAction, refundUsage } from "@/lib/accountStore";
import { readJsonBody } from "@/lib/limitedBody";
import { resolveUsageIdentity } from "@/lib/usageIdentity";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = await readJsonBody<{ actionId?: unknown; status?: unknown }>(request, 16 * 1024).catch(() => null);
  const actionId = typeof body?.actionId === "string" && UUID_PATTERN.test(body.actionId) ? body.actionId : "";
  const status = body?.status === "succeeded" || body?.status === "cancelled" || body?.status === "failed" ? body.status : "";
  if (!actionId || !status) return NextResponse.json({ error: "全文翻译任务状态无效。" }, { status: 400 });
  try {
    const identity = await resolveUsageIdentity(request);
    if (!identity.authenticated) return NextResponse.json({ error: "需要登录账号。" }, { status: 401 });
    if (identity.localOnly) return NextResponse.json({ ok: true });
    const action = await getUsageAction(actionId);
    if (
      !action
      || action.ownerKey !== identity.ownerKey
      || action.feature !== "full_article_translation"
      || !["full_article_translation", "learning_points"].includes(action.metricKey)
    ) {
      return NextResponse.json({ error: "全文翻译任务不存在。" }, { status: 404 });
    }
    if (action.metricKey === "learning_points") { await billingRpc("translation_finish", { p_action: actionId }); return NextResponse.json({ ok: true }); }
    if (status === "succeeded") await finishUsage(actionId, "succeeded");
    else await refundUsage(actionId, status, status === "cancelled" ? "translation_cancelled" : "translation_incomplete");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "全文翻译任务状态暂时无法保存。" }, { status: 503 });
  }
}
