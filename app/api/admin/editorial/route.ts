import { NextResponse } from "next/server";
import { parseEditorialBudgetTrial } from "@/lib/editorialBudgetPolicy";
import { isAdminRequest } from "@/lib/adminAuth";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { readJsonBody } from "@/lib/limitedBody";
import { getEditorialConfig, EDITORIAL_CONFIG_KEY } from "@/lib/editorialReview";
import { withDiscoveryLease, writeDiscoverySetting } from "@/lib/discoveryStore";
import {anyTextKey} from '@/lib/modelSettings';

export async function GET() {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  return NextResponse.json({ config: await getEditorialConfig(), jevConfigured: !!process.env.AI_GATEWAY_API_KEY, deepseekConfigured: !!process.env.DEEPSEEK_API_KEY }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request) {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站后台操作。" }, { status: 403 });
  const body = await readJsonBody<Record<string, unknown>>(request, 2048).catch(() => null);
  if (!body || typeof body.enabled !== "boolean" || !["deepseek", "jev-shadow"].includes(String(body.provider)) || !Number.isInteger(body.dailyReviewLimit) || Number(body.dailyReviewLimit) < 30 || Number(body.dailyReviewLimit) > 240 || typeof body.jevMonthlyBudgetUsd !== "number" || !Number.isFinite(body.jevMonthlyBudgetUsd) || body.jevMonthlyBudgetUsd <= 0 || body.jevMonthlyBudgetUsd > 4) return NextResponse.json({ error: "请使用有效设置：每日尝试 30–240 篇，Jev 月预算大于 0 且不超过 $4。" }, { status: 400 });
  if (body.dailyBudgetCny !== undefined && (typeof body.dailyBudgetCny !== "number" || !Number.isFinite(body.dailyBudgetCny) || body.dailyBudgetCny < 0 || body.dailyBudgetCny > 1.5)) return NextResponse.json({ error: "当前每日预算上限为 1.50 元。" }, { status: 400 });
  if (body.enabled && !anyTextKey()) return NextResponse.json({ error: "尚未配置文字模型密钥，无法开启自动精选。" }, { status: 400 });
  if (body.budgetTrial !== undefined && body.budgetTrial !== null && !parseEditorialBudgetTrial(body.budgetTrial)) return NextResponse.json({ error: "临时预算须指定有效日期；金额须大于 0、不超过 10 元，或明确设为 null 表示当日不限额。" }, { status: 400 });
  if (body.jevAutoAdopt !== undefined && typeof body.jevAutoAdopt !== "boolean") return NextResponse.json({ error: "自动采用须为布尔值。" }, { status: 400 });
  try {
    await withDiscoveryLease(async () => {
      const previous = await getEditorialConfig();
      await writeDiscoverySetting(EDITORIAL_CONFIG_KEY, { enabled: body.enabled, provider: body.provider, dailyReviewLimit: body.dailyReviewLimit, jevMonthlyBudgetUsd: body.jevMonthlyBudgetUsd, dailyBudgetCny: body.dailyBudgetCny ?? previous.dailyBudgetCny, budgetTrial: body.budgetTrial === undefined ? previous.budgetTrial : parseEditorialBudgetTrial(body.budgetTrial), jevAutoAdopt: body.jevAutoAdopt ?? previous.jevAutoAdopt });
    });
    return NextResponse.json({ config: await getEditorialConfig() });
  } catch { return NextResponse.json({ error: "抓取正在运行，请稍后保存设置。" }, { status: 409 }); }
}
