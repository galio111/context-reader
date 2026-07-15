import { NextResponse } from "next/server";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { ARTICLE_TOPICS } from "@/types/publicArticle";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function scheduledTopic(): (typeof ARTICLE_TOPICS)[number] {
  const shanghaiDay = Math.floor((Date.now() + 8 * 60 * 60 * 1000) / 86_400_000);
  return ARTICLE_TOPICS[shanghaiDay % ARTICLE_TOPICS.length];
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRecommendationCrawler(
      { topic: scheduledTopic(), difficulty: "any", targetInventory: 6, maxNewArticles: 2 },
      new URL(request.url).origin,
    );
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Scheduled crawler failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
