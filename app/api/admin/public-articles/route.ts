import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { createPublicArticle, deletePublicArticle, listPublicArticles } from "@/lib/publicArticles";
import type { PublicArticleInput } from "@/types/publicArticle";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }

  try {
    const articles = await listPublicArticles();
    return NextResponse.json({ articles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章读取失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }

  const input = (await request.json().catch(() => null)) as PublicArticleInput | null;
  if (!input?.body?.trim() || !input.title?.trim()) {
    return NextResponse.json({ error: "缺少文章标题或正文。" }, { status: 400 });
  }

  try {
    const article = await createPublicArticle(input);
    return NextResponse.json({ article });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章发布失败。" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "缺少公开文章 ID。" }, { status: 400 });
  }

  try {
    await deletePublicArticle(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章删除失败。" },
      { status: 500 },
    );
  }
}
