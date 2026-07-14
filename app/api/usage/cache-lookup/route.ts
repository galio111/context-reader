import { NextResponse } from "next/server";
import { finishUsage } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";

export async function POST(request: Request) {
  try {
    const usage = await gateUsage(request, {
      feature: "cached_word_lookup",
      metricKey: "lookup_generation",
      units: 1,
    });

    if (!usage.identity.authenticated) {
      await finishUsage(usage.actionId, "cached", true).catch(() => undefined);
    }
    return NextResponse.json({
      ok: true,
      actionId: usage.actionId,
      remaining: usage.reservation.remaining,
      counted: !usage.identity.authenticated,
    });
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "记录游客试用失败。" }, { status: 500 });
  }
}
