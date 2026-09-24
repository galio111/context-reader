import { NextResponse } from "next/server";
import { listPublicArticleSummaries } from "@/lib/publicArticles";
import { getHomepageCuration } from "@/lib/homepageCuration";
import { countDailyPublications, shanghaiDay } from "@/lib/dailyPublicationUpdates";

export async function GET() {
  try {
    const [articles, curation] = await Promise.all([listPublicArticleSummaries(), getHomepageCuration()]);
    const day = shanghaiDay();
    return NextResponse.json({ day, count: countDailyPublications(articles.map(a => a.id), curation.selectedAtById, day) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "更新数量暂时无法读取" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
