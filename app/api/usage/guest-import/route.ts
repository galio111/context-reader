import { NextResponse } from "next/server";
import { finishUsage } from "@/lib/accountStore";
import { readJsonBody } from "@/lib/limitedBody";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";

export async function POST(request: Request) {
  const body = await readJsonBody<{ kind?: unknown }>(request, 4 * 1024).catch(() => null);
  const kind = body?.kind === "url" ? "url" : body?.kind === "text" ? "text" : null;
  if (!kind) return NextResponse.json({ error: "导入类型无效。" }, { status: 400 });

  try {
    const usage = await gateUsage(request, {
      feature: kind === "url" ? "guest_url_import" : "guest_text_import",
      metricKey: "deep_reading",
      guestMetricKey: kind === "url" ? "guest_url_import" : "guest_text_import",
      guestOnly: true,
      units: 1,
    });
    if (!usage.identity.authenticated) {
      await finishUsage(usage.actionId, "succeeded").catch(() => undefined);
    }
    return NextResponse.json({
      ok: true,
      counted: !usage.identity.authenticated,
      remaining: usage.identity.authenticated ? null : usage.reservation.remaining,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "游客导入次数校验失败，请稍后重试。" }, { status: 500 });
  }
}
