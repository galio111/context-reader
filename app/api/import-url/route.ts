import { NextResponse } from "next/server";
import { readResponseText, safeRemoteFetch, UnsafeRemoteUrlError } from "@/lib/safeRemoteFetch";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
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

function metaContent(html: string, key: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0] ?? "";
    const name = getAttribute(tag, "property") || getAttribute(tag, "name");
    if (name.toLowerCase() === key.toLowerCase()) {
      return getAttribute(tag, "content");
    }
  }
  return "";
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

const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const ALWAYS_NOISE_TAGS = new Set(["script", "style", "svg", "noscript", "template", "nav", "footer", "aside", "form", "button", "iframe"]);
const NOISE_ROLE_PATTERN = /^(?:navigation|complementary|contentinfo|dialog)$/i;
const NOISE_IDENTITY_PATTERN = /(?:^|[-_])(?:related(?:[-_]?(?:topics?|terms?|stories|articles|releases|links|content))?|recommend(?:ed|ation|ations)?|suggested|story[-_]?source|journal[-_]?references?|citations?|cite[-_]?this|explore[-_]?more|read[-_]?more|more[-_]?(?:stories|articles|from)|newsletter|comments?|disqus|share(?:[-_]?(?:buttons?|links?|tools?|icons?))?|sharing|social[-_]?(?:share|sharing|buttons?|links?|tools?|icons?)|outbrain|taboola|advert(?:isement|ising)?|sponsored|promo|paywall|subscription|cookie|consent|breadcrumb|sidebar|site[-_]?(?:header|footer)|navigation)(?:$|[-_])/i;

function isNoiseElement(tagName: string, tag: string): boolean {
  if (ALWAYS_NOISE_TAGS.has(tagName)) {
    return true;
  }
  if (NOISE_ROLE_PATTERN.test(getAttribute(tag, "role"))) {
    return true;
  }
  const identityTokens = `${getAttribute(tag, "id")} ${getAttribute(tag, "class")}`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return identityTokens.some((token) => NOISE_IDENTITY_PATTERN.test(token));
}

function stripNoise(html: string): string {
  const output: string[] = [];
  const stack: Array<{ tagName: string; skipped: boolean }> = [];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let cursor = 0;
  let skipDepth = 0;

  for (const match of html.matchAll(tokenPattern)) {
    const raw = match[0] ?? "";
    const index = match.index ?? cursor;
    if (skipDepth === 0) {
      output.push(html.slice(cursor, index));
    }
    cursor = index + raw.length;

    if (raw.startsWith("<!--") || raw.startsWith("<!")) {
      continue;
    }

    const tagName = (match[1] ?? "").toLowerCase();
    if (!tagName) {
      continue;
    }
    const closing = /^<\//.test(raw);
    if (closing) {
      const wasSkipping = skipDepth > 0;
      let matchingIndex = stack.length - 1;
      while (matchingIndex >= 0 && stack[matchingIndex]?.tagName !== tagName) {
        matchingIndex -= 1;
      }
      if (matchingIndex >= 0) {
        const closed = stack.splice(matchingIndex);
        skipDepth -= closed.filter((entry) => entry.skipped).length;
      }
      if (!wasSkipping && skipDepth === 0) {
        output.push(raw);
      }
      continue;
    }

    const selfClosing = /\/\s*>$/.test(raw) || VOID_HTML_TAGS.has(tagName);
    const skipped = skipDepth > 0 || isNoiseElement(tagName, raw);
    if (!skipped && skipDepth === 0) {
      output.push(raw);
    }
    if (!selfClosing) {
      stack.push({ tagName, skipped });
      if (skipped) {
        skipDepth += 1;
      }
    }
  }

  if (skipDepth === 0) {
    output.push(html.slice(cursor));
  }
  return output.join("");
}

function metadata(html: string, baseUrl: string) {
  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const siteName =
    metaContent(html, "og:site_name") ||
    new URL(baseUrl).hostname.replace(/^www\./, "");
  const description = metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description");
  const coverCandidates = [
    metaContent(html, "og:image"),
    metaContent(html, "og:image:secure_url"),
    metaContent(html, "twitter:image"),
    metaContent(html, "twitter:image:src"),
  ]
    .map((value) => absoluteUrl(value, baseUrl))
    .filter((value, index, values) => value && values.indexOf(value) === index);

  return {
    title: title || "Imported Article",
    siteName,
    description,
    coverCandidates,
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

interface ArticleHtmlCandidate {
  html: string;
  bonus: number;
}

function candidateBonus(tagName: string, tag: string): number | null {
  if (tagName === "article") {
    return 6_000;
  }
  if (tagName === "main") {
    return 2_000;
  }
  if (tagName !== "section" && tagName !== "div") {
    return null;
  }
  const identity = `${getAttribute(tag, "id")} ${getAttribute(tag, "class")}`.toLowerCase();
  if (!/(?:^|[\s_-])(?:article|content|post|story|entry|body)(?:$|[\s_-])/.test(identity)) {
    return null;
  }
  return /(?:article[-_]?body|article[-_]?content|entry[-_]?content|post[-_]?content|story[-_]?text)/.test(identity)
    ? 10_000
    : 0;
}

function balancedArticleCandidates(html: string): ArticleHtmlCandidate[] {
  const candidates: ArticleHtmlCandidate[] = [];
  const stack: Array<{ tagName: string; start: number; bonus: number | null }> = [];
  const tagPattern = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;

  for (const match of html.matchAll(tagPattern)) {
    const raw = match[0] ?? "";
    const tagName = (match[1] ?? "").toLowerCase();
    if (!tagName) {
      continue;
    }
    if (/^<\//.test(raw)) {
      let matchingIndex = stack.length - 1;
      while (matchingIndex >= 0 && stack[matchingIndex]?.tagName !== tagName) {
        matchingIndex -= 1;
      }
      if (matchingIndex < 0) {
        continue;
      }
      const frame = stack[matchingIndex];
      stack.splice(matchingIndex);
      if (frame && frame.bonus !== null) {
        candidates.push({
          html: html.slice(frame.start, (match.index ?? frame.start) + raw.length),
          bonus: frame.bonus,
        });
      }
      continue;
    }
    if (/\/\s*>$/.test(raw) || VOID_HTML_TAGS.has(tagName)) {
      continue;
    }
    stack.push({
      tagName,
      start: match.index ?? 0,
      bonus: candidateBonus(tagName, raw),
    });
  }
  return candidates;
}

function extractMainHtml(html: string): string {
  const candidates = balancedArticleCandidates(html);
  if (candidates.length === 0) {
    return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  }

  return candidates.sort(
    (left, right) => scoreArticleCandidate(right.html) + right.bonus - scoreArticleCandidate(left.html) - left.bonus,
  )[0]?.html ?? html;
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
          ...(Number.isFinite(width) && width > 0 ? { width } : {}),
          ...(Number.isFinite(height) && height > 0 ? { height } : {}),
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

const STANDALONE_AD_LABEL = /^(?:ad|ads|advert(?:isement|isements|ising)?|sponsored(?:\s+content)?|paid\s+content)\.?$/i;
const AD_TOPIC_PATTERN = /\b(?:advertis(?:e|ed|er|ers|es|ing|ement|ements)|advertorials?|ad\s+(?:agency|agencies|campaign|campaigns|industry|market|markets|revenue|revenues|spend|spending))\b/i;

const EMBEDDED_UI_NOISE_PATTERNS = [
  /personalized\s+content/i,
  /follow\s+(?:this|the)\s+(?:section|tag|topic)/i,
  /personalize\s+your\s+feed/i,
  /go\s+to\s+your\s+personalized\s+feed/i,
  /why\s+follow\??/i,
  /custom\s+feed:\s*see\s+the\s+stories/i,
  /smart\s+alerts?:\s*get\s+notified/i,
  /update\s+your\s+preferences\s+in\s+account\s+settings/i,
];

const TRAILING_SECTION_PATTERN = /^(?:related\s+(?:topics?|terms?|stories|articles|content)|story\s+source|journal\s+references?|cite\s+this\s+page|explore\s+more|recommended(?:\s+for\s+you)?|you\s+(?:may|might)\s+also\s+like|read\s+next|more\s+(?:stories|articles|from)|most\s+popular|trending|about\s+the\s+author|sign\s+up\s+for\b|advertisement)\b/i;

function normalizedBlockText(block: ImportedArticleBlock): string {
  return block.text?.replace(/\s+/g, " ").trim() ?? "";
}

function articleIsAboutAdvertising(blocks: ImportedArticleBlock[], title: string): boolean {
  if (AD_TOPIC_PATTERN.test(title)) {
    return true;
  }

  let substantiveMentions = 0;
  for (const block of blocks) {
    const text = normalizedBlockText(block);
    if (text.length >= 40 && AD_TOPIC_PATTERN.test(text)) {
      substantiveMentions += 1;
      if (substantiveMentions >= 2) {
        return true;
      }
    }
  }
  return false;
}

function cleanExtractedBlocks(blocks: ImportedArticleBlock[], title: string): ImportedArticleBlock[] {
  const keepStandaloneAdLabels = articleIsAboutAdvertising(blocks, title);
  let substantiveBlocks = 0;
  let substantiveCharacters = 0;
  let trailingBoundary = blocks.length;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.type === "image") {
      continue;
    }
    const text = normalizedBlockText(block);
    if (substantiveBlocks >= 3 && substantiveCharacters >= 400 && TRAILING_SECTION_PATTERN.test(text)) {
      trailingBoundary = index;
      break;
    }
    if (text.length >= 40) {
      substantiveBlocks += 1;
      substantiveCharacters += text.length;
    }
  }

  return blocks
    .slice(0, trailingBoundary)
    .filter((block) => {
      if (block.type === "image") {
        return true;
      }

      const text = normalizedBlockText(block);
      if (EMBEDDED_UI_NOISE_PATTERNS.some((pattern) => pattern.test(text))) {
        return false;
      }

      if (!keepStandaloneAdLabels && STANDALONE_AD_LABEL.test(text)) {
        return false;
      }

      return true;
    })
    .map((block, index) => ({ ...block, id: `block-${index}` }));
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

  if (!["http:", "https:"].includes(url.protocol)) {
    return NextResponse.json({ error: "只支持 http 或 https 文章链接。" }, { status: 400 });
  }

  try {
    const response = await safeRemoteFetch(url, {
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

    const html = await readResponseText(response, MAX_HTML_CHARS);
    const cleaned = stripNoise(html);
    const meta = metadata(cleaned, url.toString());
    const mainHtml = extractMainHtml(cleaned);
    const blocks = cleanExtractedBlocks(
      extractBlocks(mainHtml, url.toString(), meta.title),
      meta.title,
    );
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

    const coverCandidates = [
      ...meta.coverCandidates,
      ...blocks.filter((block) => block.type === "image" && block.src).map((block) => block.src as string),
    ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 8);

    return NextResponse.json({
      article: importedArticle,
      metadata: {
        description: meta.description,
        coverCandidates,
      },
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
