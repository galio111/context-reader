import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { localizeImportedArticleImages } from "@/lib/publicArticleCovers";
import { verifyUrlImportImageToken } from "@/lib/urlImportImageToken";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type { ImportedArticle } from "@/types/article";

export const runtime = "nodejs";

function isImportedArticle(value: unknown): value is ImportedArticle {
  const article = value as Partial<ImportedArticle>;
  return Boolean(
    article
    && typeof article.title === "string"
    && typeof article.url === "string"
    && typeof article.siteName === "string"
    && typeof article.text === "string"
    && Array.isArray(article.blocks)
    && article.blocks.length <= 2_000,
  );
}

export async function POST(request: Request) {
  let body: { article?: unknown; freshImport?: unknown; imageLocalizationToken?: unknown };
  try {
    body = await readJsonBody(request, 4 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "文章内容过大。" : "请求格式不正确。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!isImportedArticle(body.article)) {
    return NextResponse.json({ error: "文章图片数据格式不正确。" }, { status: 400 });
  }
  const freshImport = body.freshImport === true;
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user && !freshImport) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  if (freshImport) {
    try {
      const sourceUrl = new URL(body.article.url);
      if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      return NextResponse.json({ error: "新导入文章缺少有效来源网址。" }, { status: 400 });
    }
    if (
      typeof body.imageLocalizationToken !== "string"
      || !verifyUrlImportImageToken(body.article, body.imageLocalizationToken)
    ) {
      return NextResponse.json({ error: "图片保存凭证无效或已过期，请重新导入文章。" }, { status: 403 });
    }
  }

  try {
    const localized = await localizeImportedArticleImages(body.article, body.article.url, {
      removeFailed: freshImport,
    });
    return NextResponse.json(localized, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文章图片暂时无法保存到本站。" },
      { status: 502 },
    );
  }
}
