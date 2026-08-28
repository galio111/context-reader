import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { removeAuthorIdentityBlocks, trimTrailingWebsiteBlocks } from "@/lib/articleContentSanitizer";
import type {
  ImportedArticle,
  ImportedArticleBlock,
  ImportedArticleInlineBaseline,
  ImportedArticleInlineText,
  ImportedArticleTable,
  ImportedArticleTableCell,
} from "@/types/article";

const MAX_TEXT_CHARS = 80_000;
const MAX_BLOCKS = 320;
const MAX_IMAGE_BLOCKS = 24;
const MAX_TABLES = 12;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 40;
const MAX_TABLE_CELL_CHARS = 2_000;

const NOISE_IDENTITY_PATTERN = /(?:^|[\s_-])(?:ad(?:s|vert|verts|server|slot|wrapper)?|advert(?:isement|ising)?|sponsored|promo(?:tion)?|outbrain|taboola|newsletter|comments?|disqus|share(?:[\s_-]?(?:buttons?|links?|tools?|icons?))?|social(?:[\s_-]?(?:share|sharing|buttons?|links?|tools?|icons?))?|cookie|consent|paywall|subscription|breadcrumb|sidebar|site[\s_-]?(?:header|footer)|global[\s_-]?(?:header|footer|nav)|related(?:[\s_-]?(?:stories|articles|content|links))?|recommend(?:ed|ation|ations)?|story[\s_-]?meta|byline|author[\s_-]?(?:bio|card|info|meta|photo|profile)|contributor[\s_-]?(?:bio|card|info|meta|photo|profile)|audio[\s_-]?(?:embed|module|player|tool|tools|controls?)|podcast[\s_-]?(?:embed|module|player|tool|tools|controls?)|media[\s_-]?(?:embed|player|controls?)|embed[\s_-]?overlay)(?:$|[\s_-])/i;
const HIDDEN_IDENTITY_PATTERN = /(?:^|[\s_-])(?:hidden|is-hidden|visually-hidden|sr-only|screen-reader-text|u-hidden)(?:$|[\s_-])/i;
const UI_TEXT_PATTERN = /^(?:advertisement|sponsored(?: content)?|paid content|read more|learn more|sign up|subscribe|accept(?: all)? cookies|manage cookies|share(?: this article)?|open menu|close menu|previous article|next article|download|embed|transcript|toggle more options|toggle caption|hide caption|show caption)\.?$/i;
const CREDIT_LABEL_PATTERN = /^(?:©\s*)?(?:photo|image|picture)?\s*credits?:?$/i;
const IMAGE_CREDIT_ATTRIBUTION_PATTERN = /^(?:(?:photo|image|picture)\s+(?:by|courtesy\s+of)\s+)?\p{Lu}[\p{L}\p{M}.'’]*(?:[ -]+\p{Lu}[\p{L}\p{M}.'’]*){0,5}(?:\s*\/\s*|,?\s+via\s+)(?:NPR|AP|AFP|Reuters|Getty(?:\s+Images)?|Shutterstock|Bloomberg|EPA|Alamy|Unsplash|Associated\s+Press)$/u;
const IMAGE_CREDIT_SUFFIX_PATTERN = /\s+(?:(?:photo|image|picture)\s+(?:by|courtesy\s+of)\s+)?\p{Lu}[\p{L}\p{M}.'’]*(?:[ -]+\p{Lu}[\p{L}\p{M}.'’]*){0,5}(?:\s*\/\s*|,?\s+via\s+)(?:NPR|AP|AFP|Reuters|Getty(?:\s+Images)?|Shutterstock|Bloomberg|EPA|Alamy|Unsplash|Associated\s+Press)$/u;
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
  /<iframe\b[^>]*\bsrc\s*=/i,
  /embedded\s+(?:audio|video)\s+player/i,
  /does\s+not\s+offer\s+or\s+accept\s+money\s+for\s+coverage\s+or\s+interviews/i,
  /\bedited\s+the\s+(?:broadcast|digital|audio|print|web)(?:\s+and\s+(?:broadcast|digital|audio|print|web))*\s+versions?\s+of\s+this\s+(?:story|article)/i,
];

interface ExtractionMetadata {
  description: string;
  coverCandidates: string[];
}

export interface ExtractedUrlArticle {
  article: ImportedArticle;
  metadata: ExtractionMetadata;
}

interface Candidate {
  root: Element;
  kind: "readability" | "article-body" | "article" | "main" | "content" | "body";
  blocks: ImportedArticleBlock[];
  textCharacters: number;
  substantiveBlocks: number;
  linkDensity: number;
  score: number;
}

interface ExtractContext {
  baseUrl: string;
  title: string;
  blocks: ImportedArticleBlock[];
  seenText: Set<string>;
  seenImages: Set<string>;
  imageCount: number;
  tableCount: number;
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function singleLineText(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string, baseUrl: string): string {
  if (!value || /^(?:data|blob|javascript):/i.test(value)) {
    return "";
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function metaContent(document: Document, key: string): string {
  const escaped = key.replace(/["\\]/g, "\\$&");
  return singleLineText(
    document.querySelector(`meta[property="${escaped}"], meta[name="${escaped}"]`)?.getAttribute("content") ?? "",
  );
}

function isHiddenElement(element: Element): boolean {
  const style = (element.getAttribute("style") ?? "").replace(/\s+/g, "").toLowerCase();
  const identity = `${element.id} ${element.className || ""}`;
  return (
    element.hasAttribute("hidden") ||
    element.hasAttribute("inert") ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
    /(?:^|;)(?:display:none|visibility:hidden|content-visibility:hidden|opacity:0)(?:;|$)/.test(style) ||
    HIDDEN_IDENTITY_PATTERN.test(identity)
  );
}

function hasNoiseIdentity(element: Element): boolean {
  const identity = [
    element.id,
    element.className || "",
    element.getAttribute("data-testid") ?? "",
    element.getAttribute("data-component") ?? "",
    element.getAttribute("aria-label") ?? "",
  ].join(" ");
  return NOISE_IDENTITY_PATTERN.test(identity);
}

function removeHighConfidenceNoise(document: Document): void {
  const fixedNoise = document.querySelectorAll(
    "script, style, noscript, template, nav, footer, form, button, input, select, textarea, iframe, canvas, svg, dialog, .toggle-caption, .hide-caption, [class*='caption-toggle'], [role='navigation'], [role='contentinfo'], [role='dialog'], [role='alert'], [role='complementary']",
  );
  fixedNoise.forEach((element) => element.remove());

  for (const element of Array.from(document.querySelectorAll("body *"))) {
    if (!element.isConnected) continue;
    if (isHiddenElement(element) || hasNoiseIdentity(element)) {
      element.remove();
    }
  }
}

function imageFromSrcset(value: string): string {
  const candidates = Array.from(value.matchAll(/(\S+)\s+(\d+)w(?=\s*(?:,|$))/g), (match) => ({
    url: (match[1] ?? "").replace(/^,\s*/, ""),
    width: Number.parseInt(match[2] ?? "0", 10),
  })).filter((entry) => entry.url && Number.isFinite(entry.width));
  if (candidates.length === 0) {
    const fallback = value.trim().split(/\s+/)[0] ?? "";
    return fallback.replace(/,$/, "");
  }
  const suitable = candidates.filter((entry) => entry.width >= 640 && entry.width <= 1_280);
  return suitable.sort((left, right) => right.width - left.width)[0]?.url
    ?? candidates.sort((left, right) => right.width - left.width)[0]?.url
    ?? "";
}

function imageSource(element: Element, baseUrl: string): string {
  return absoluteUrl(
    imageFromSrcset(element.getAttribute("srcset") ?? element.getAttribute("data-srcset") ?? "") ||
      element.getAttribute("data-src") ||
      element.getAttribute("data-original") ||
      element.getAttribute("data-lazy-src") ||
      element.getAttribute("src") ||
      "",
    baseUrl,
  );
}

function numericAttribute(element: Element, name: string): number | undefined {
  const parsed = Number.parseInt(element.getAttribute(name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function linkDensity(root: Element): number {
  const textLength = singleLineText(root.textContent ?? "").length;
  if (!textLength) return 1;
  const linkedTextLength = Array.from(root.querySelectorAll("a"))
    .reduce((sum, link) => sum + singleLineText(link.textContent ?? "").length, 0);
  return Math.min(1, linkedTextLength / textLength);
}

function isLinkCluster(element: Element, text: string): boolean {
  if (text.length > 260) return false;
  const density = linkDensity(element);
  if (density < 0.88) return false;
  if (element.tagName.toLowerCase() === "li") return true;
  const parent = element.parentElement;
  if (!parent) return false;
  const siblings = Array.from(parent.children).filter((sibling) => linkDensity(sibling) >= 0.88);
  return siblings.length >= 3;
}

function isLinkedCardImage(element: Element, src: string, baseUrl: string): boolean {
  const link = element.closest("a[href]");
  if (!link) return false;
  const href = absoluteUrl(link.getAttribute("href") ?? "", baseUrl);
  if (!href || href === baseUrl || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(href)) return false;
  try {
    const source = new URL(src);
    const target = new URL(href);
    if (source.pathname === target.pathname) return false;
  } catch {
    return false;
  }
  const identity = `${link.id} ${link.className || ""} ${link.parentElement?.className || ""}`;
  return /card|promo|teaser|related|recommend|story|article|tile/i.test(identity) || singleLineText(link.textContent ?? "").length < 180;
}

function inlineText(element: Element): ImportedArticleInlineText[] | undefined {
  const segments: ImportedArticleInlineText[] = [];

  function append(text: string, baseline?: ImportedArticleInlineBaseline) {
    const normalized = text.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
    if (!normalized) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.baseline === baseline) previous.text += normalized;
    else segments.push({ text: normalized, ...(baseline ? { baseline } : {}) });
  }

  function visit(node: Node, baseline?: ImportedArticleInlineBaseline) {
    if (node.nodeType === node.TEXT_NODE) {
      append(node.textContent ?? "", baseline);
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const child = node as Element;
    if (isHiddenElement(child)) return;
    const tag = child.tagName.toLowerCase();
    if (tag === "br") {
      append("\n", baseline);
      return;
    }
    const nextBaseline = tag === "sup" || tag === "sub" ? tag : baseline;
    child.childNodes.forEach((item) => visit(item, nextBaseline));
  }

  element.childNodes.forEach((node) => visit(node));
  if (segments.length === 0) return undefined;
  segments[0]!.text = segments[0]!.text.trimStart();
  segments[segments.length - 1]!.text = segments[segments.length - 1]!.text.trimEnd();
  const filtered = segments.filter((segment) => segment.text);
  return filtered.some((segment) => segment.baseline) ? filtered : undefined;
}

function addTextBlock(
  context: ExtractContext,
  type: "heading" | "subheading" | "paragraph" | "quote" | "caption" | "list-item",
  element: Element,
  extra: Pick<ImportedArticleBlock, "listStyle" | "listLevel" | "listOrdinal"> = {},
): void {
  if (context.blocks.length >= MAX_BLOCKS) return;
  const normalizedText = normalizeText(element.textContent ?? "");
  const text = (IMAGE_CREDIT_ATTRIBUTION_PATTERN.test(normalizedText)
    ? normalizedText
    : normalizedText.replace(IMAGE_CREDIT_SUFFIX_PATTERN, "")).trim();
  if (text.length < 2 || UI_TEXT_PATTERN.test(text) || EMBEDDED_UI_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return;
  if (isLinkCluster(element, text)) return;
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  if (context.seenText.has(normalized)) return;
  context.seenText.add(normalized);
  const inline = inlineText(element);
  context.blocks.push({
    id: `block-${context.blocks.length}`,
    type,
    text,
    ...(inline ? { inline } : {}),
    ...extra,
  });
}

function addImageBlock(context: ExtractContext, element: Element): void {
  if (context.blocks.length >= MAX_BLOCKS || context.imageCount >= MAX_IMAGE_BLOCKS || isHiddenElement(element)) return;
  const src = imageSource(element, context.baseUrl);
  if (!src || context.seenImages.has(src) || /\.(?:svg)(?:[?#]|$)/i.test(src) || /(?:pixel|tracking|avatar|icon|logo|sprite|badge)/i.test(src)) return;
  const width = numericAttribute(element, "width");
  const height = numericAttribute(element, "height");
  if ((width && width < 180) || (height && height < 120) || (width && height && width * height < 36_000)) return;
  if (isLinkedCardImage(element, src, context.baseUrl)) return;
  const alt = singleLineText(element.getAttribute("alt") ?? "");
  const auxiliaryIdentity = `${element.parentElement?.className || ""} ${element.closest("[rel='author'], [class*='byline'], [class*='author-'], [class*='author_']")?.className || ""}`;
  if (/\b(?:headshot|author|contributor|profile)\b/i.test(auxiliaryIdentity) && /\b(?:headshot|portrait|profile|author)\b/i.test(alt)) return;
  const inFigure = Boolean(element.closest("figure"));
  if (!inFigure && !alt && !width && !height) return;
  context.seenImages.add(src);
  context.imageCount += 1;
  context.blocks.push({
    id: `block-${context.blocks.length}`,
    type: "image",
    src,
    alt,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  });
}

function boundedSpan(element: Element, name: "rowspan" | "colspan"): number | undefined {
  const value = numericAttribute(element, name);
  return value && value > 1 ? Math.min(50, value) : undefined;
}

function tableFromElement(element: Element): ImportedArticleTable | null {
  const rows: ImportedArticleTableCell[][] = [];
  for (const row of Array.from(element.querySelectorAll("tr"))) {
    if (row.closest("table") !== element || rows.length >= MAX_TABLE_ROWS) continue;
    const cells = Array.from(row.children)
      .filter((child) => /^(?:td|th)$/i.test(child.tagName))
      .slice(0, MAX_TABLE_COLUMNS)
      .map((cell): ImportedArticleTableCell => {
        const header = cell.tagName.toLowerCase() === "th";
        const scope = cell.getAttribute("scope")?.toLowerCase();
        return {
          text: normalizeText(cell.textContent ?? "").slice(0, MAX_TABLE_CELL_CHARS),
          ...(header ? { header: true } : {}),
          ...(scope === "row" || scope === "col" ? { scope } : {}),
          ...(boundedSpan(cell, "rowspan") ? { rowSpan: boundedSpan(cell, "rowspan") } : {}),
          ...(boundedSpan(cell, "colspan") ? { colSpan: boundedSpan(cell, "colspan") } : {}),
        };
      });
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0 || rows.every((row) => row.every((cell) => !cell.text))) return null;
  const caption = normalizeText(Array.from(element.children).find((child) => child.tagName.toLowerCase() === "caption")?.textContent ?? "");
  return { ...(caption ? { caption } : {}), rows };
}

function addTableBlock(context: ExtractContext, element: Element): void {
  if (context.blocks.length >= MAX_BLOCKS || context.tableCount >= MAX_TABLES) return;
  const table = tableFromElement(element);
  if (!table) return;
  const text = [table.caption, ...table.rows.map((row) => row.map((cell) => cell.text).join(" | "))]
    .filter(Boolean)
    .join("\n");
  if (text.length < 2) return;
  context.tableCount += 1;
  context.blocks.push({ id: `block-${context.blocks.length}`, type: "table", text, table });
}

function processList(context: ExtractContext, list: Element, level = 0): void {
  const style = list.tagName.toLowerCase() === "ol" ? "ordered" : "unordered";
  const start = style === "ordered" ? numericAttribute(list, "start") ?? 1 : 1;
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li");
  items.forEach((item, index) => {
    const copy = item.cloneNode(true) as Element;
    copy.querySelectorAll("ol, ul").forEach((nested) => nested.remove());
    addTextBlock(context, "list-item", copy, {
      listStyle: style,
      listLevel: Math.min(4, level),
      ...(style === "ordered" ? { listOrdinal: start + index } : {}),
    });
    Array.from(item.children)
      .filter((child) => /^(?:ol|ul)$/i.test(child.tagName))
      .forEach((nested) => processList(context, nested, level + 1));
  });
}

function walkContent(context: ExtractContext, parent: Element): void {
  for (const element of Array.from(parent.children)) {
    if (context.blocks.length >= MAX_BLOCKS || isHiddenElement(element) || hasNoiseIdentity(element)) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && element.hasAttribute("href") && element.querySelector("h1,h2,h3,h4,h5,h6,p,figure,picture,img")) {
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      addTextBlock(context, tag === "h1" ? "heading" : "subheading", element);
      continue;
    }
    if (tag === "p" || tag === "pre") {
      addTextBlock(context, "paragraph", element);
      continue;
    }
    if (tag === "blockquote") {
      const paragraphs = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "p");
      if (paragraphs.length) paragraphs.forEach((paragraph) => addTextBlock(context, "quote", paragraph));
      else addTextBlock(context, "quote", element);
      continue;
    }
    if (tag === "ol" || tag === "ul") {
      processList(context, element);
      continue;
    }
    if (tag === "table") {
      addTableBlock(context, element);
      continue;
    }
    if (tag === "figure") {
      const images = Array.from(element.querySelectorAll("img")).filter((image) => image.closest("figure") === element);
      images.forEach((image) => addImageBlock(context, image));
      const caption = Array.from(element.querySelectorAll("figcaption, [aria-label='Image caption'], .caption"))
        .find((child) => child.closest("figure") === element);
      if (caption) addTextBlock(context, "caption", caption);
      continue;
    }
    if (tag === "picture") {
      const image = element.querySelector("img");
      if (image) addImageBlock(context, image);
      continue;
    }
    if (tag === "img") {
      addImageBlock(context, element);
      continue;
    }
    if (tag === "a" && isLinkCluster(element, singleLineText(element.textContent ?? ""))) continue;

    const hasStructuredDescendant = Boolean(element.querySelector("h1,h2,h3,h4,h5,h6,p,pre,blockquote,ol,ul,table,figure,picture,img"));
    if (hasStructuredDescendant) walkContent(context, element);
    else if (/^(?:article|section|div|main|header|address|dd|dt)$/.test(tag)) addTextBlock(context, "paragraph", element);
  }
}

function articleIsAboutAdvertising(blocks: ImportedArticleBlock[], title: string): boolean {
  if (AD_TOPIC_PATTERN.test(title)) return true;
  return blocks.filter((block) => (block.text?.length ?? 0) >= 40 && AD_TOPIC_PATTERN.test(block.text ?? "")).length >= 2;
}

function cleanBlocks(blocks: ImportedArticleBlock[], title: string): ImportedArticleBlock[] {
  const preserveAdLabels = articleIsAboutAdvertising(blocks, title);
  const bounded = removeAuthorIdentityBlocks(trimTrailingWebsiteBlocks(blocks));
  const cleaned = bounded.filter((block, index) => {
    if (block.type === "image" || block.type === "table") return true;
    const text = singleLineText(block.text ?? "");
    const nextText = singleLineText(bounded[index + 1]?.text ?? "");
    const imageCreditAttribution = text.length <= 120 && CREDIT_LABEL_PATTERN.test(nextText);
    return !CREDIT_LABEL_PATTERN.test(text) && !IMAGE_CREDIT_ATTRIBUTION_PATTERN.test(text) && !imageCreditAttribution && !EMBEDDED_UI_NOISE_PATTERNS.some((pattern) => pattern.test(text)) && (preserveAdLabels || !UI_TEXT_PATTERN.test(text));
  });
  if (!cleaned.some((block) => block.type === "heading") && title) {
    cleaned.unshift({ id: "block-title", type: "heading", text: title });
  }
  return cleaned.map((block, index) => ({ ...block, id: `block-${index}` }));
}

function extractBlocks(root: Element, baseUrl: string, title: string): ImportedArticleBlock[] {
  const context: ExtractContext = {
    baseUrl,
    title,
    blocks: [],
    seenText: new Set(),
    seenImages: new Set(),
    imageCount: 0,
    tableCount: 0,
  };
  walkContent(context, root);
  return cleanBlocks(context.blocks, title);
}

export function importedArticleBlocksToText(blocks: ImportedArticleBlock[]): string {
  return blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);
}

function candidateFromRoot(root: Element, kind: Candidate["kind"], baseUrl: string, title: string): Candidate | null {
  const blocks = extractBlocks(root, baseUrl, title);
  const textBlocks = blocks.filter((block) => block.type !== "image");
  const textCharacters = textBlocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
  const substantiveBlocks = textBlocks.filter((block) => (block.text?.length ?? 0) >= 40 || block.type === "table").length;
  if (textCharacters < 80 || substantiveBlocks === 0) return null;
  const density = linkDensity(root);
  const kindBonus = {
    readability: 2_600,
    "article-body": 3_200,
    article: 2_200,
    main: 1_200,
    content: 800,
    body: 0,
  }[kind];
  const score = textCharacters + substantiveBlocks * 180 + blocks.filter((block) => block.type === "table").length * 650 + kindBonus - density * 2_400;
  return { root, kind, blocks, textCharacters, substantiveBlocks, linkDensity: density, score };
}

function structuralCandidates(document: Document, baseUrl: string, title: string): Candidate[] {
  const roots = new Map<Element, Candidate["kind"]>();
  const add = (selector: string, kind: Candidate["kind"], limit: number) => {
    Array.from(document.querySelectorAll(selector)).slice(0, limit).forEach((element) => {
      if (!roots.has(element)) roots.set(element, kind);
    });
  };
  add("[itemprop='articleBody'], [data-article-body], .article-body, .article__body, .article-content, .article__content, .story-body, .story__body, .entry-content, .post-content", "article-body", 16);
  add("article", "article", 12);
  add("main, [role='main']", "main", 8);
  add("#content, #main-content, .main-content, .story-content, .post-body", "content", 12);
  if (document.body) roots.set(document.body, "body");
  return Array.from(roots, ([root, kind]) => candidateFromRoot(root, kind, baseUrl, title)).filter((candidate): candidate is Candidate => Boolean(candidate));
}

function chooseCandidate(candidates: Candidate[]): Candidate | null {
  const readability = candidates.find((candidate) => candidate.kind === "readability");
  const specific = candidates
    .filter((candidate) => candidate.kind === "article-body")
    .sort((left, right) => right.score - left.score)[0];
  if (specific && (!readability || specific.textCharacters >= readability.textCharacters * 0.72)) return specific;
  const structural = candidates
    .filter((candidate) => candidate.kind !== "readability")
    .sort((left, right) => right.score - left.score)[0];
  if (!readability) return structural ?? null;
  const readabilityTableCount = readability.blocks.filter((block) => block.type === "table").length;
  const structuralTableCount = structural?.blocks.filter((block) => block.type === "table").length ?? 0;
  const readabilityImageCount = readability.blocks.filter((block) => block.type === "image").length;
  const structuralImageCount = structural?.blocks.filter((block) => block.type === "image").length ?? 0;
  if (
    structural &&
    structuralTableCount > readabilityTableCount &&
    structural.textCharacters >= readability.textCharacters * 0.75 &&
    structural.linkDensity <= 0.2
  ) {
    return structural;
  }
  if (
    structural &&
    structuralImageCount > readabilityImageCount &&
    structural.textCharacters >= readability.textCharacters * 0.85 &&
    structural.linkDensity <= 0.16
  ) {
    return structural;
  }
  if (
    structural &&
    structural.textCharacters >= readability.textCharacters * 1.5 &&
    structural.substantiveBlocks >= readability.substantiveBlocks + 3 &&
    structural.linkDensity <= 0.16
  ) {
    return structural;
  }
  return readability;
}

function uniqueUrls(values: string[], baseUrl: string): string[] {
  return values
    .map((value) => absoluteUrl(value, baseUrl))
    .filter((value, index, urls) => Boolean(value) && urls.indexOf(value) === index);
}

function titleWithoutSiteSuffix(value: string, siteName: string): string {
  const title = singleLineText(value);
  const site = singleLineText(siteName);
  if (!title || !site) return title;
  const suffix = new RegExp(`\\s+(?:[-|·•]|—)\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return title.replace(suffix, "").trim() || title;
}

export function extractImportedArticleFromHtml(html: string, baseUrl: string): ExtractedUrlArticle | null {
  const dom = new JSDOM(html, { url: baseUrl, contentType: "text/html" });
  const document = dom.window.document;
  const metadataTitle = metaContent(document, "og:title") || metaContent(document, "twitter:title") || singleLineText(document.title);
  const metadataDescription = metaContent(document, "og:description") || metaContent(document, "description") || metaContent(document, "twitter:description");
  const metadataSiteName = metaContent(document, "og:site_name") || new URL(baseUrl).hostname.replace(/^www\./, "");
  const metaCoverCandidates = uniqueUrls([
    metaContent(document, "og:image"),
    metaContent(document, "og:image:secure_url"),
    metaContent(document, "twitter:image"),
    metaContent(document, "twitter:image:src"),
  ], baseUrl);

  removeHighConfidenceNoise(document);
  const readabilityDocument = document.cloneNode(true) as Document;
  const readable = new Readability(readabilityDocument, {
    charThreshold: 120,
    maxElemsToParse: 60_000,
    nbTopCandidates: 8,
  }).parse();
  const title = titleWithoutSiteSuffix(readable?.title || metadataTitle || "Imported Article", metadataSiteName);
  const candidates = structuralCandidates(document, baseUrl, title);
  if (readable?.content) {
    const readableDom = new JSDOM(`<main>${readable.content}</main>`, { url: baseUrl, contentType: "text/html" });
    const readableRoot = readableDom.window.document.querySelector("main");
    if (readableRoot) {
      const candidate = candidateFromRoot(readableRoot, "readability", baseUrl, title);
      if (candidate) candidates.push(candidate);
    }
  }
  const selected = chooseCandidate(candidates);
  if (!selected) return null;
  const text = importedArticleBlocksToText(selected.blocks);
  if (text.length < 80) return null;
  const imageSources = selected.blocks
    .filter((block) => block.type === "image" && block.src)
    .map((block) => block.src as string);
  return {
    article: {
      title,
      siteName: singleLineText(readable?.siteName || metadataSiteName),
      url: baseUrl,
      text,
      blocks: selected.blocks,
      ...(singleLineText(readable?.byline || "") ? { byline: singleLineText(readable?.byline || "") } : {}),
      ...(singleLineText(readable?.publishedTime || "") ? { publishedTime: singleLineText(readable?.publishedTime || "") } : {}),
      ...(singleLineText(readable?.lang || document.documentElement.lang || "") ? { language: singleLineText(readable?.lang || document.documentElement.lang || "") } : {}),
    },
    metadata: {
      description: singleLineText(readable?.excerpt || metadataDescription),
      coverCandidates: uniqueUrls([...metaCoverCandidates, ...imageSources], baseUrl).slice(0, 12),
    },
  };
}
