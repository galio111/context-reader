import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { createPublicArticle, deletePublicArticle, listPublicArticles } from "@/lib/publicArticles";
import type { PublicArticleInput } from "@/types/publicArticle";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBoundedString(value: unknown, maxLength: number, required = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (!required || value.trim().length > 0);
}

function isSafePublicArticleInput(value: unknown): value is PublicArticleInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<PublicArticleInput>;
  if (
    !isBoundedString(input.title, 200, true) ||
    !isBoundedString(input.body, 500_000, true) ||
    !isBoundedString(input.summary, 1_000) ||
    (input.sourceUrl !== undefined && !isBoundedString(input.sourceUrl, 2_048)) ||
    (input.sourceName !== undefined && !isBoundedString(input.sourceName, 200)) ||
    (input.explanations !== undefined && (!Array.isArray(input.explanations) || input.explanations.length > 3_000)) ||
    (input.articleTranslations !== undefined && (!Array.isArray(input.articleTranslations) || input.articleTranslations.length > 2_000))
  ) {
    return false;
  }
  if (input.importedArticle !== undefined && input.importedArticle !== null) {
    if (typeof input.importedArticle !== "object" || !Array.isArray(input.importedArticle.blocks) || input.importedArticle.blocks.length > 5_000) {
      return false;
    }
    if (input.importedArticle.blocks.some((block) => !block || typeof block !== "object")) {
      return false;
    }
  }
  if (input.sourceUrl) {
    try {
      if (!["http:", "https:"].includes(new URL(input.sourceUrl).protocol)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (input.explanations?.some((item) => (
    !item ||
    typeof item !== "object" ||
    !isBoundedString(item.cacheKey, 1_000, true) ||
    !isBoundedString(item.word, 200, true) ||
    !isBoundedString(item.sentence, 2_000, true) ||
    !item.explanation ||
    typeof item.explanation !== "object"
  ))) {
    return false;
  }
  if (input.articleTranslations?.some((item) => (
    !item ||
    typeof item !== "object" ||
    !isBoundedString(item.cacheKey, 1_000, true) ||
    !Array.isArray(item.translations) ||
    item.translations.length > 5_000 ||
    item.translations.some((translation) => (
      !translation ||
      typeof translation !== "object" ||
      !isBoundedString(translation.id, 200, true) ||
      !isBoundedString(translation.translation, 5_000, true)
    ))
  ))) {
    return false;
  }
  return true;
}

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
  if (!id || !UUID_PATTERN.test(id)) {
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
