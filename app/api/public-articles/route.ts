import { NextResponse } from "next/server";
import { listPublicArticles } from "@/lib/publicArticles";

export async function GET() {
  try {
    const articles = await listPublicArticles();
    return NextResponse.json({ articles });
  } catch (error) {
    return NextResponse.json(
      { articles: [], error: error instanceof Error ? error.message : "公开推荐文章读取失败。" },
      { status: 200 },
    );
  }
}

