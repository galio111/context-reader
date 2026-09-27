import { NextResponse } from "next/server";
import { listPublicArticleSummaries } from "@/lib/publicArticles";
import { getHomepageCuration } from "@/lib/homepageCuration";
import { normalizeRecommendationPreferences } from "@/lib/recommendationPreferencesShared";
import { homepageShowcaseArticles, orderHomepageRecommendations, HOMEPAGE_RECOMMENDATION_TARGET } from "@/lib/homepageRecommendations";
import { shanghaiDay } from "@/lib/discoveryPolicy";

/** Public preferences only; evaluate the complete whitelist and return one finite window. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const preferences = normalizeRecommendationPreferences({ readingLevel: params.get("level"), interests: (params.get("interests") || "").split(",") });
  try {
    const [all, curation] = await Promise.all([listPublicArticleSummaries(), getHomepageCuration()]);
    const day = shanghaiDay(new Date().toISOString());
    const articles = homepageShowcaseArticles(orderHomepageRecommendations(all, curation, preferences, day), HOMEPAGE_RECOMMENDATION_TARGET);
    return NextResponse.json({ articles, day }, { headers: { "Cache-Control": "public, max-age=0, must-revalidate" } });
  } catch {
    return NextResponse.json({ error: "推荐暂时无法更新，已有文章仍可阅读。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
