import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import {
  deleteArticleCandidate,
  listArticleCandidates,
  listRejectedArticleCandidates,
  publishArticleCandidate,
  saveArticleCandidate,
  setArticleCandidateRejected,
} from "@/lib/publicArticles";
import { getHomepageCuration, saveHomepageCuration } from "@/lib/homepageCuration";
import { EDITORIAL_CATEGORIES, editorialCategoryForArticle, placePublishedArticle, type EditorialCategory } from "@/lib/editorialCuration";
import { isSafePublicArticleInput, UUID_PATTERN } from "@/lib/publicArticleInput";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  try {
    const [articles, rejectedArticles] = await Promise.all([listArticleCandidates(), listRejectedArticleCandidates()]);
    return NextResponse.json({ articles, rejectedArticles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "候选文章读取失败。" },
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
      { error: error instanceof RequestBodyTooLargeError ? "候选文章数据过大。" : "候选文章数据不是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!isSafePublicArticleInput(input, true)) {
    return NextResponse.json({ error: "候选文章格式无效或内容过大。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ article: await saveArticleCandidate(input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "候选文章保存失败。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  let body: { id?: unknown; ids?: unknown; action?: unknown; category?: unknown; featured?: unknown } | null;
  try {
    body = await readJsonBody(request, 32 * 1024);
  } catch {
    return NextResponse.json({ error: "发布请求不是合法 JSON。" }, { status: 400 });
  }
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)).slice(0, 100)
    : typeof body?.id === "string" && UUID_PATTERN.test(body.id) ? [body.id] : [];
  if ((body?.action === "reject" || body?.action === "restore") && ids.length === 1) {
    try {
      const article = await setArticleCandidateRejected(ids[0], body.action === "reject");
      return NextResponse.json({ article });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "候选状态更新失败。" }, { status: 400 });
    }
  }
  if (body?.action !== "publish" || ids.length === 0) {
    return NextResponse.json({ error: "缺少有效的候选文章 ID。" }, { status: 400 });
  }

  const category = typeof body.category === "string" && EDITORIAL_CATEGORIES.includes(body.category as EditorialCategory)
    ? body.category as EditorialCategory
    : null;
  const published = [];
  for (const id of ids) {
    try {
      const article = await publishArticleCandidate(id);
      published.push(article);
      const articleCategory = category ?? editorialCategoryForArticle(article);
      const current = await getHomepageCuration();
      await saveHomepageCuration(placePublishedArticle(current, article.id, articleCategory, body.featured === true));
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "候选文章发布失败。",
          articles: published,
          failedId: id,
        },
        { status: 400 },
      );
    }
  }
  return NextResponse.json({ articles: published });
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "缺少有效的候选文章 ID。" }, { status: 400 });
  }
  try {
    await deleteArticleCandidate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "候选文章删除失败。" },
      { status: 500 },
    );
  }
}
