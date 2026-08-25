import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { readResponseText, safeRemoteFetch, UnsafeRemoteUrlError } from "@/lib/safeRemoteFetch";
import { localizeImportedArticleImages } from "@/lib/publicArticleCovers";
import { extractImportedArticleFromHtml } from "@/lib/urlArticleExtractor";

const MAX_HTML_CHARS = 1_200_000;

export async function POST(request: Request) {
  let body: { url?: unknown } | null;
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "请先输入文章 URL。" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL 格式不正确，请输入完整的网址。" }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return NextResponse.json({ error: "只支持 http 或 https 文章链接。" }, { status: 400 });
  }

  try {
    const response = await safeRemoteFetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `网页读取失败，目标网站返回 ${response.status}。` },
        { status: 502 },
      );
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return NextResponse.json({ error: "这个链接不像是普通 HTML 文章页面。" }, { status: 400 });
    }

    const html = await readResponseText(response, MAX_HTML_CHARS);
    const extracted = extractImportedArticleFromHtml(html, response.url || url.toString());
    if (!extracted?.article.text || extracted.article.text.length < 80) {
      return NextResponse.json(
        { error: "没有提取到足够的正文，可能是登录墙、反爬或动态加载页面。" },
        { status: 422 },
      );
    }

    const localized = await localizeImportedArticleImages(extracted.article, response.url || url.toString());
    if (localized.failures.length) {
      return NextResponse.json(
        {
          error: `正文已读取，但有 ${localized.failures.length} 张图片未能保存到本站。请稍后重试，失败导入不会消耗游客次数。`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ...extracted, article: localized.article });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: "该网址指向受保护的内部地址，无法导入。" }, { status: 400 });
    }
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "网页读取超时，请稍后重试。"
        : "网页读取失败，请检查链接是否能公开访问。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
