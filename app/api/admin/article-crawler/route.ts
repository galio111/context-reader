import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { RECOMMENDATION_CRAWLER_SOURCES } from "@/lib/recommendationSources";
import { ARTICLE_DIFFICULTIES, ARTICLE_TOPICS } from "@/types/publicArticle";
import type { RecommendationCrawlerRunInput } from "@/types/recommendationCrawler";

export const maxDuration = 60;

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  return NextResponse.json({
    scheduled: Boolean(process.env.CRON_SECRET?.trim()),
    scheduleLabel: "每天约 03:00（北京时间）自动轮换一个主题",
    maxNewArticlesPerRun: 2,
    sources: RECOMMENDATION_CRAWLER_SOURCES.map(({ id, name, topics }) => ({ id, name, topics })),
  });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  let body: Partial<RecommendationCrawlerRunInput> | null;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch {
    return NextResponse.json({ error: "抓取设置不是合法 JSON。" }, { status: 400 });
  }
  const topic = typeof body?.topic === "string" && ARTICLE_TOPICS.includes(body.topic) ? body.topic : null;
  const difficulty = body?.difficulty === "any" || (typeof body?.difficulty === "string" && ARTICLE_DIFFICULTIES.includes(body.difficulty))
    ? body.difficulty
    : null;
  const targetInventory = typeof body?.targetInventory === "number" && Number.isInteger(body.targetInventory)
    ? body.targetInventory
    : 0;
  if (!topic || !difficulty || targetInventory < 1 || targetInventory > 30) {
    return NextResponse.json({ error: "请选择有效主题、难度和 1 至 30 篇的目标库存。" }, { status: 400 });
  }
  try {
    const result = await runRecommendationCrawler(
      { topic, difficulty, targetInventory, maxNewArticles: 2 },
      new URL(request.url).origin,
    );
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动抓取任务失败。" },
      { status: 500 },
    );
  }
}
