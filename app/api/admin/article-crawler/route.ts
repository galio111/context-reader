import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { readJsonBody } from "@/lib/limitedBody";
import {
  getRecommendationAutomationStatus,
  runConfiguredRecommendationAutomation,
  updateRecommendationAutomationConfig,
} from "@/lib/recommendationAutomation";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { RECOMMENDATION_CRAWLER_SOURCES } from "@/lib/recommendationSources";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { sendSiteNotificationEmail } from "@/lib/siteNotificationEmail";
import { ARTICLE_DIFFICULTIES, ARTICLE_TOPICS } from "@/types/publicArticle";
import type { RecommendationCrawlerRunInput } from "@/types/recommendationCrawler";

export const maxDuration = 900;

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const automation = await getRecommendationAutomationStatus();
  return NextResponse.json({
    scheduled: Boolean(process.env.CRON_SECRET?.trim()) && automation.config.enabled,
    scheduleLabel: automation.config.enabled
      ? `每天约 ${automation.config.runTime}（北京时间），每次目标新增 ${automation.config.maxNewArticles} 篇`
      : "定时自动补充已关闭",
    maxNewArticlesPerRun: automation.config.maxNewArticles,
    automation,
    sources: RECOMMENDATION_CRAWLER_SOURCES.map(({ id, name, topics, levelHint }) => ({ id, name, topics, levelHint })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const body = await readJsonBody<Record<string, unknown>>(request, 8 * 1024).catch(() => null);
  if (!body) return NextResponse.json({ error: "定时设置格式无效。" }, { status: 400 });
  try {
    const automation = await updateRecommendationAutomationConfig({
      enabled: body.enabled !== false,
      runTime: String(body.runTime || ""),
      maxNewArticles: Number(body.maxNewArticles),
    });
    await accountFetch("admin_audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        admin_label: "recommendation-admin",
        action: "update_recommendation_automation",
        target_type: "site_setting",
        target_id: "recommendation_automation_config",
        after_value: automation.config,
      }]),
    });
    return NextResponse.json({ automation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "定时设置保存失败。" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  let body: (Partial<RecommendationCrawlerRunInput> & { action?: string }) | null;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch {
    return NextResponse.json({ error: "抓取设置不是合法 JSON。" }, { status: 400 });
  }
  if (body?.action === "run_now") {
    try {
      const run = await runConfiguredRecommendationAutomation(requestExternalOrigin(request), "manual");
      return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "立即执行失败。" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  if (body?.action === "test_email") {
    const sentAt = new Date();
    const email = await sendSiteNotificationEmail(
      "[Context Reader] 定时推荐邮件测试成功",
      [
        "Context Reader 的定时推荐邮件配置已经验证成功。",
        "",
        `测试时间：${sentAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        "以后每天的自动推荐任务成功完成后，会向这个邮箱发送运行结果。",
        "手动执行推荐任务不会自动发送完成邮件。",
      ].join("\n"),
    );
    if (email.status !== "sent") {
      return NextResponse.json(
        { error: email.error || "测试邮件发送失败。", emailStatus: email.status },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ ok: true, emailStatus: email.status }, { headers: { "Cache-Control": "no-store" } });
  }
  const topic = typeof body?.topic === "string" && ARTICLE_TOPICS.includes(body.topic) ? body.topic : null;
  const difficulty = body?.difficulty === "any" || (typeof body?.difficulty === "string" && ARTICLE_DIFFICULTIES.includes(body.difficulty))
    ? body.difficulty
    : null;
  const maxNewArticles = typeof body?.maxNewArticles === "number" && Number.isInteger(body.maxNewArticles)
    ? body.maxNewArticles
    : 0;
  if (!topic || !difficulty || maxNewArticles < 1 || maxNewArticles > 10) {
    return NextResponse.json({ error: "请选择有效主题、难度和本次目标新增 1 至 10 篇。" }, { status: 400 });
  }
  try {
    const result = await runRecommendationCrawler(
      {
        topic,
        difficulty,
        targetInventory: 0,
        maxNewArticles,
        inventoryScope: body?.inventoryScope === "candidates" ? "candidates" : "all",
        ignoreInventoryTarget: true,
      },
      requestExternalOrigin(request),
    );
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动抓取任务失败。" },
      { status: 500 },
    );
  }
}
