import { NextResponse } from "next/server";
import { getPublicArticle } from "@/lib/publicArticles";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const article = await getPublicArticle(id);
    if (!article) {
      return NextResponse.json({ error: "没有找到这篇公开文章。" }, { status: 404 });
    }
    return NextResponse.json({ article });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章读取失败。" },
      { status: 500 },
    );
  }
}

