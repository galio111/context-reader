import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { createPublicArticle, deletePublicArticle, listPublicArticles, updatePublicArticle } from "@/lib/publicArticles";
import { isSafePublicArticleInput, UUID_PATTERN } from "@/lib/publicArticleInput";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  try {
    return NextResponse.json({ articles: await listPublicArticles() });
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
  let input: unknown;
  try {
    input = await readJsonBody(request, 8 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "发布数据过大。" : "发布数据不是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!isSafePublicArticleInput(input)) {
    return NextResponse.json({ error: "发布数据格式无效或内容过大。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ article: await createPublicArticle(input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章发布失败。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  let input: unknown;
  try {
    input = await readJsonBody(request, 8 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "更新数据过大。" : "更新数据不是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!isSafePublicArticleInput(input, true) || !input.id) {
    return NextResponse.json({ error: "更新数据格式无效。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ article: await updatePublicArticle(input.id, input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开文章更新失败。" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) {
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
