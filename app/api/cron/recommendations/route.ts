import { NextResponse } from "next/server";
import { runConfiguredRecommendationAutomation } from "@/lib/recommendationAutomation";
import { requestExternalOrigin } from "@/lib/requestSecurity";

export const maxDuration = 360;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const run = await runConfiguredRecommendationAutomation(requestExternalOrigin(request), "scheduled");
    return NextResponse.json({ ok: true, ...run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Scheduled crawler failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
