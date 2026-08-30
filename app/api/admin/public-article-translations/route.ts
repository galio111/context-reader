import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { replaceManagedArticleTranslation } from "@/lib/publicArticles";
import { UUID_PATTERN } from "@/lib/publicArticleInput";
import type { ArticleTranslationItem } from "@/types/reader";

interface UploadBody {
  articleId?: unknown;
  cacheKey?: unknown;
  translations?: unknown;
}

function validTranslations(value: unknown): value is ArticleTranslationItem[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 5_000
    && value.every((item) => (
      item
      && typeof item === "object"
      && typeof (item as ArticleTranslationItem).id === "string"
      && (item as ArticleTranslationItem).id.length <= 200
      && typeof (item as ArticleTranslationItem).translation === "string"
      && (item as ArticleTranslationItem).translation.trim().length > 0
      && (item as ArticleTranslationItem).translation.length <= 5_000
    ));
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  let body: UploadBody;
  try {
    body = await readJsonBody<UploadBody>(request, 2 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "全文翻译数据过大。" : "上传内容不是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (
    typeof body.articleId !== "string"
    || !UUID_PATTERN.test(body.articleId)
    || typeof body.cacheKey !== "string"
    || !/^[a-z0-9]{1,32}$/i.test(body.cacheKey)
    || !validTranslations(body.translations)
  ) {
    return NextResponse.json({ error: "全文翻译格式无效。" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      ok: true,
      ...(await replaceManagedArticleTranslation(body.articleId, {
        cacheKey: body.cacheKey,
        translations: body.translations,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "全文翻译上传失败。" },
      { status: 400 },
    );
  }
}
