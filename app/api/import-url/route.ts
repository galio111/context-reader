import { NextResponse } from "next/server";
import type {
  ImportedArticle,
  ImportedArticleBlock,
  ImportedArticleBlockType,
  ImportedArticleInlineBaseline,
  ImportedArticleInlineText,
} from "@/types/article";

const MAX_HTML_CHARS = 1_200_000;
const MAX_TEXT_CHARS = 80_000;
const MAX_BLOCKS = 220;
const MAX_IMAGE_BLOCKS = 12;

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match);
}

function cleanText(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .trim(),
  );
}

function normalizeInlineText(value: string): string {
  const decoded = decodeHtml(value);
  if (/^\n+$/.test(decoded)) {
    return decoded;
  }
  return decoded.replace(/[ \t\f\v\r\n]+/g, " ");
}

function getAttribute(tag: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return decodeHtml(match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim();
}

function imageCandidateFromSrcset(srcset: string): string {
  const candidates = srcset
    .split(",")
    .map((item) => {
      const [url = "", descriptor = ""] = item.trim().split(/\s+/, 2);
      const width = descriptor.endsWith("w") ? Number.parseInt(descriptor, 10) : Number.POSITIVE_INFINITY;
      return {
        url,
        width: Number.isFinite(width) ? width : Number.POSITIVE_INFINITY,
      };
    })
    .filter((item) => item.url);

  return (
    candidates
      .filter((item) => item.width >= 640)
      .sort((a, b) => a.width - b.width)[0]?.url ||
    candidates.sort((a, b) => a.width - b.width)[0]?.url ||
    ""
  );
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(nav|footer|aside|form|button|iframe)[\s\S]*?<\/\1>/gi, "");
}

function metadata(html: string, baseUrl: string) {
  const title =
    getAttribute(html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0] ?? "", "content") ||
    getAttribute(html.match(/<meta[^>]+name=["']twitter:title["'][^>]*>/i)?.[0] ?? "", "content") ||
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const siteName =
    getAttribute(html.match(/<meta[^>]+property=["']og:site_name["'][^>]*>/i)?.[0] ?? "", "content") ||
    new URL(baseUrl).hostname.replace(/^www\./, "");

  return {
    title: title || "Imported Article",
    siteName,
  };
}

function scoreArticleCandidate(fragment: string): number {
  const text = cleanText(fragment);
  const paragraphCount = (fragment.match(/<p[\s>]/gi) ?? []).length;
  const headingCount = (fragment.match(/<h[1-3][\s>]/gi) ?? []).length;
  const linkText = cleanText((fragment.match(/<a[\s\S]*?<\/a>/gi) ?? []).join(" "));
  const linkDensity = text.length ? linkText.length / text.length : 1;

  return text.length + paragraphCount * 350 + headingCount * 120 - linkDensity * 1500;
}

function extractMainHtml(html: string): string {
  const candidates = [
    ...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi),
    ...html.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/gi),
    ...html.matchAll(/<section\b[^>]*(?:article|content|post|story|entry)[^>]*>[\s\S]*?<\/section>/gi),
    ...html.matchAll(/<div\b[^>]*(?:article|content|post|story|entry|body)[^>]*>[\s\S]*?<\/div>/gi),
  ].map((match) => match[0]);

  if (candidates.length === 0) {
    return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  }

  return candidates.sort((a, b) => scoreArticleCandidate(b) - scoreArticleCandidate(a))[0];
}

function absoluteUrl(value: string, baseUrl: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function blockTypeForTag(tagName: string): ImportedArticleBlockType {
  if (/^h1$/i.test(tagName)) {
    return "heading";
  }
  if (/^h[2-3]$/i.test(tagName)) {
    return "subheading";
  }
  if (/^li$/i.test(tagName)) {
    return "list-item";
  }
  if (/^blockquote$/i.test(tagName)) {
    return "quote";
  }
  return "paragraph";
}

function extractInlineText(fragment: string): ImportedArticleInlineText[] {
  const inline: ImportedArticleInlineText[] = [];
  const baselineStack: ImportedArticleInlineBaseline[] = [];
  const tokenPattern = /<[^>]+>|[^<]+/g;

  function currentBaseline(): ImportedArticleInlineBaseline | undefined {
    return baselineStack[baselineStack.length - 1];
  }

  function appendText(text: string) {
    const normalized = normalizeInlineText(text);
    if (!normalized) {
      return;
    }
    const baseline = currentBaseline();
    const previous = inline[inline.length - 1];
    if (previous && previous.baseline === baseline) {
      previous.text += normalized;
      return;
    }
    inline.push({
      text: normalized,
      ...(baseline ? { baseline } : {}),
    });
  }

  for (const match of fragment.matchAll(tokenPattern)) {
    const token = match[0] ?? "";
    if (!token) {
      continue;
    }

    if (!token.startsWith("<")) {
      appendText(token);
      continue;
    }

    if (/^<br\b/i.test(token)) {
      appendText("\n");
      continue;
    }

    const closeMatch = token.match(/^<\/\s*(sup|sub)\s*>/i);
    if (closeMatch) {
      baselineStack.pop();
      continue;
    }

    const openMatch = token.match(/^<\s*(sup|sub)\b/i);
    if (openMatch) {
      baselineStack.push(openMatch[1].toLowerCase() as ImportedArticleInlineBaseline);
    }
  }

  return inline
    .map((item, index, items) => {
      let text = item.text;
      if (index === 0) {
        text = text.trimStart();
      }
      if (index === items.length - 1) {
        text = text.trimEnd();
      }
      return { ...item, text };
    })
    .filter((item) => item.text);
}

function extractBlocks(mainHtml: string, baseUrl: string, title: string): ImportedArticleBlock[] {
  const blocks: ImportedArticleBlock[] = [];
  const seenText = new Set<string>();
  let imageCount = 0;
  const blockPattern = /<(h1|h2|h3|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>/gi;

  for (const match of mainHtml.matchAll(blockPattern)) {
    if (blocks.length >= MAX_BLOCKS) {
      break;
    }

    const raw = match[0] ?? "";
    if (/^<img/i.test(raw)) {
      if (imageCount >= MAX_IMAGE_BLOCKS) {
        continue;
      }
      const width = Number.parseInt(getAttribute(raw, "width"), 10);
      const height = Number.parseInt(getAttribute(raw, "height"), 10);
      if (
        (Number.isFinite(width) && width > 0 && width < 180) ||
        (Number.isFinite(height) && height > 0 && height < 120)
      ) {
        continue;
      }
      const src = absoluteUrl(
        getAttribute(raw, "src") ||
          imageCandidateFromSrcset(getAttribute(raw, "srcset") || getAttribute(raw, "data-srcset")) ||
          getAttribute(raw, "data-src") ||
          getAttribute(raw, "data-original") ||
          getAttribute(raw, "data-lazy-src"),
        baseUrl,
      );
      if (
        src &&
        !/\.(?:svg|gif)(?:[?#]|$)/i.test(src) &&
        !/(?:pixel|tracking|avatar|icon|logo|sprite)/i.test(src) &&
        !blocks.some((block) => block.type === "image" && block.src === src)
      ) {
        blocks.push({
          id: `block-${blocks.length}`,
          type: "image",
          src,
          alt: getAttribute(raw, "alt"),
        });
        imageCount += 1;
      }
      continue;
    }

    const tagName = match[1] ?? "p";
    const rawContent = match[2] ?? "";
    const inline = extractInlineText(rawContent);
    const text = inline.length
      ? inline.map((item) => item.text).join("").replace(/[ \t\f\v]+/g, " ").trim()
      : cleanText(rawContent);
    const normalized = text.replace(/\s+/g, " ").toLowerCase();
    if (text.length < 2 || seenText.has(normalized)) {
      continue;
    }
    seenText.add(normalized);
    blocks.push({
      id: `block-${blocks.length}`,
      type: blockTypeForTag(tagName),
      text,
      ...(inline.some((item) => item.baseline) ? { inline } : {}),
    });
  }

  if (!blocks.some((block) => block.type === "heading") && title) {
    blocks.unshift({
      id: "block-title",
      type: "heading",
      text: title,
    });
  }

  return blocks.map((block, index) => ({ ...block, id: `block-${index}` }));
}

function articleText(blocks: ImportedArticleBlock[]): string {
  return blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
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

  if (!["http:", "https:"].includes(url.protocol)) {
    return NextResponse.json({ error: "只支持 http 或 https 文章链接。" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `网页读取失败，目标网站返回 ${response.status}。` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return NextResponse.json({ error: "这个链接不像是普通 HTML 文章页面。" }, { status: 400 });
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const cleaned = stripNoise(html);
    const meta = metadata(cleaned, url.toString());
    const mainHtml = extractMainHtml(cleaned);
    const blocks = extractBlocks(mainHtml, url.toString(), meta.title);
    const text = articleText(blocks);

    if (text.length < 80) {
      return NextResponse.json(
        { error: "没有提取到足够的正文，可能是登录墙、反爬或动态加载页面。" },
        { status: 422 },
      );
    }

    const importedArticle: ImportedArticle = {
      title: meta.title,
      siteName: meta.siteName,
      url: url.toString(),
      text,
      blocks,
    };

    return NextResponse.json({ article: importedArticle });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "网页读取超时，请稍后重试。"
        : "网页读取失败，请检查链接是否能公开访问。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
