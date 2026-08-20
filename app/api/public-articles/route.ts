import { NextResponse } from "next/server";
import { listPublicArticleSummaries } from "@/lib/publicArticles";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
};

export async function GET() {
  try {
    const articles = await listPublicArticleSummaries();
    return NextResponse.json({ articles }, { headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { articles: [], error: error instanceof Error ? error.message : "公开推荐文章读取失败。" },
      { status: 200, headers: PUBLIC_CACHE_HEADERS },
    );
  }
}
