import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { readJsonBody } from "@/lib/limitedBody";
import { getEditorialConfig, EDITORIAL_CONFIG_KEY } from "@/lib/editorialReview";
import { withDiscoveryLease, writeDiscoverySetting } from "@/lib/discoveryStore";

export async function GET() {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  return NextResponse.json({ config: await getEditorialConfig(), jevConfigured: !!process.env.AI_GATEWAY_API_KEY, deepseekConfigured: !!process.env.DEEPSEEK_API_KEY }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request) {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站后台操作。" }, { status: 403 });
  const body = await readJsonBody<Record<string, unknown>>(request, 2048).catch(() => null);
  if (!body || typeof body.enabled !== "boolean" || !["deepseek", "jev-shadow"].includes(String(body.provider)) || !Number.isInteger(body.dailyReviewLimit) || Number(body.dailyReviewLimit) < 30 || Number(body.dailyReviewLimit) > 150 || typeof body.jevMonthlyBudgetUsd !== "number" || !Number.isFinite(body.jevMonthlyBudgetUsd) || body.jevMonthlyBudgetUsd <= 0 || body.jevMonthlyBudgetUsd > 4) return NextResponse.json({ error: "请使用有效设置：每日尝试 30–150 篇，Jev 月预算大于 0 且不超过 $4。" }, { status: 400 });
  if (body.enabled && !process.env.DEEPSEEK_API_KEY) return NextResponse.json({ error: "尚未配置 DeepSeek，无法开启自动精选。" }, { status: 400 });
  try {
    await withDiscoveryLease(async () => writeDiscoverySetting(EDITORIAL_CONFIG_KEY, { enabled: body.enabled, provider: body.provider, dailyReviewLimit: body.dailyReviewLimit, jevMonthlyBudgetUsd: body.jevMonthlyBudgetUsd }));
    return NextResponse.json({ config: await getEditorialConfig() });
  } catch { return NextResponse.json({ error: "抓取正在运行，请稍后保存设置。" }, { status: 409 }); }
}
