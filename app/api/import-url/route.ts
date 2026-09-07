import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { readResponseText, UnsafeRemoteUrlError } from "@/lib/safeRemoteFetch";
import { fetchRemoteDocument } from "@/lib/overseasFetch";
import { extractImportedArticleFromHtml } from "@/lib/urlArticleExtractor";
import { createUrlImportImageToken } from "@/lib/urlImportImageToken";

const MAX_HTML_BYTES = 1_500_000;

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
    const remote = await fetchRemoteDocument(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
    }, {
      mode: "html",
      directTimeoutMs: 5_000,
      overseasTimeoutMs: 20_000,
      signal: request.signal,
    });
    const response = remote.response;

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

    const html = await readResponseText(response, MAX_HTML_BYTES);
    const extracted = extractImportedArticleFromHtml(html, remote.finalUrl);
    if (!extracted?.article.text || extracted.article.text.length < 80) {
      return NextResponse.json(
        { error: "没有提取到足够的正文，可能是登录墙、反爬或动态加载页面。" },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ...extracted,
      imageLocalizationToken: createUrlImportImageToken(extracted.article),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
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
