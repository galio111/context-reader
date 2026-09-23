import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { listPublicArticleSummaries } from "@/lib/publicArticles";
import { publicArticleSummary } from "@/lib/publicArticleSummary";

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
};

export async function GET(request: Request) {
  try {
    const articles = await listPublicArticleSummaries();
    const body = JSON.stringify({ articles: articles.map(publicArticleSummary) });
    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
    const headers = { ...PUBLIC_CACHE_HEADERS, ETag: etag };
    // Next's compressed response appends `-gzip` to the ETag seen by the browser.
    // Accept that representation tag when the service worker revalidates its cache.
    if (request.headers.get("if-none-match")?.split(",").some((value) =>
      value.trim().replace(/^W\//, "").replace(/-gzip"$/, '"') === etag,
    )) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json(
      { articles: [], error: error instanceof Error ? error.message : "公开推荐文章读取失败。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
