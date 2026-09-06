import { JSDOM } from "jsdom";
import { normalizeImportedArticleStructure } from "@/lib/importedArticleNormalization";
import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";

const TRAILING_SECTION_PATTERN = /^(?:related\s+(?:topics?|terms?|stories|articles|content)|story\s+source|journal\s+references?|cite\s+this\s+page|explore\s+more|recommended(?:\s+for\s+you)?|you\s+(?:may|might)\s+also\s+like|read\s+next|more\s+(?:stories|articles|from)|most\s+popular|trending|about\s+the\s+author|sign\s+up\s+for\b|advertisement)\b/i;
const PUBLISHER_TRAILING_SECTIONS: Array<{ domain: string; pattern: RegExp }> = [
  { domain: "science.nasa.gov", pattern: /^downloads?$/i },
  { domain: "smithsonianmag.com", pattern: /^planning\s+your\s+next\s+trip\??$/i },
  { domain: "newsforkids.net", pattern: /^sources?$/i },
  { domain: "npr.org", pattern: /^copyright\s*(?:©|\(c\))?.*\bnpr\b/i },
  { domain: "aeon.co", pattern: /(?:prefer aeon on google|syndicate this essay)/i },
  { domain: "psyche.co", pattern: /(?:prefer psyche on google|syndicate this (?:idea|guide|note))/i },
];
const EXPLICIT_END_MARKER_PATTERN = /^[-–—]?\s*end\s*[-–—]?\.?$/i;
const AUTHOR_IMAGE_NAMESPACE_PATTERN = /(?:^|[/_.-])(?:accounts?|authors?|contributors?|people|profiles?|staff)(?:[/_.-][^/?#]*){0,4}[/_.-](?:headshots?|avatars?|author[-_ ]?(?:images?|photos?|portraits?)|profile[-_ ]?(?:images?|photos?|portraits?))(?:[/_.?#&=-]|$)/i;
const AUTHOR_IMAGE_KEYWORD_PATTERN = /(?:^|[/_.-])(?:headshots?|avatars?|author[-_ ]?(?:images?|photos?|portraits?)|profile[-_ ]?(?:images?|photos?|portraits?))(?:[/_.?#&=-]|$)/i;
const BYLINE_ROLE_PATTERN = /\b(?:author|byline|columnist|contributor|correspondent|editor|journalist|photographer|producer|reporter|staff\s+writer|writer)\b/i;
const ENTITY_PATTERN = /&(?:amp;)*(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i;
const entityDocument = new JSDOM("<!doctype html><html><body></body></html>").window.document;

export function decodeHtmlEntitiesRepeated(value: string, maxPasses = 4): string {
  let decoded = value;
  for (let pass = 0; pass < maxPasses && ENTITY_PATTERN.test(decoded); pass += 1) {
    const textarea = entityDocument.createElement("textarea");
    textarea.innerHTML = decoded;
    const next = textarea.value;
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function decodeBlockEntities(block: ImportedArticleBlock): ImportedArticleBlock {
  return {
    ...block,
    ...(typeof block.text === "string" ? { text: decodeHtmlEntitiesRepeated(block.text) } : {}),
    ...(typeof block.alt === "string" ? { alt: decodeHtmlEntitiesRepeated(block.alt) } : {}),
    ...(typeof block.caption === "string" ? { caption: decodeHtmlEntitiesRepeated(block.caption) } : {}),
    ...(block.inline ? { inline: block.inline.map((item) => ({ ...item, text: decodeHtmlEntitiesRepeated(item.text) })) } : {}),
    ...(block.table ? {
      table: {
        ...block.table,
        ...(block.table.caption ? { caption: decodeHtmlEntitiesRepeated(block.table.caption) } : {}),
        rows: block.table.rows.map((row) => row.map((cell) => ({ ...cell, text: decodeHtmlEntitiesRepeated(cell.text) }))),
      },
    } : {}),
  };
}

function normalizedBlockText(block: ImportedArticleBlock): string {
  return block.text?.replaceAll("\u00ad", "").replace(/\s+/g, " ").trim() ?? "";
}

function publisherTrailingPattern(baseUrl: string | undefined): RegExp | undefined {
  if (!baseUrl) return undefined;
  try {
    const host = new URL(baseUrl).hostname.toLocaleLowerCase("en-US");
    return PUBLISHER_TRAILING_SECTIONS.find(({ domain }) => host === domain || host.endsWith(`.${domain}`))?.pattern;
  } catch {
    return undefined;
  }
}

function normalizedCaptionText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

/**
 * Some publishers expose the same caption through both the image `alt` and a
 * following figcaption/paragraph. ReaderView intentionally renders image alt
 * text as selectable reader tokens, so retaining the adjacent copy paints the
 * caption twice. Collapse only exact adjacent duplicates; distinct captions
 * and ordinary prose remain untouched.
 */
export function removeDuplicateImageCaptionBlocks(blocks: ImportedArticleBlock[]): ImportedArticleBlock[] {
  const removeIndexes = new Set<number>();

  blocks.forEach((block, index) => {
    if (block.type !== "image") return;
    const imageCaption = normalizedCaptionText(block.alt || block.caption);
    if (!imageCaption) return;

    const following = blocks[index + 1];
    if (!following || following.type === "image" || following.type === "table") return;
    if (normalizedCaptionText(following.text) === imageCaption) removeIndexes.add(index + 1);
  });

  return blocks
    .filter((_, index) => !removeIndexes.has(index))
    .map((block, index) => ({ ...block, id: `block-${index}` }));
}

function normalizedImageIdentity(block: ImportedArticleBlock): string {
  const raw = `${block.src ?? ""} ${block.alt ?? ""}`;
  try {
    return decodeURIComponent(raw).replace(/\s+/g, " ");
  } catch {
    return raw.replace(/\s+/g, " ");
  }
}

function probablePersonName(value: string): string {
  const normalized = value
    .replace(/^(?:headshot|photo|portrait|profile(?: photo)?|image)\s+(?:of\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 80 || /[.!?;:|]/.test(normalized)) return "";
  const words = normalized.split(/\s+/);
  if (words.length < 2 || words.length > 6) return "";
  return words.every((word) => /^[\p{L}\p{M}.'’\-]+$/u.test(word)) ? normalized : "";
}

function isSmallAuthorThumbnail(block: ImportedArticleBlock, identity: string): boolean {
  if (block.width && block.height && block.width <= 480 && block.height <= 480) return true;
  const transformedSize = identity.match(/(?:fit-in|resize|fill|crop)[/=_-](\d{2,4})x(\d{2,4})/i);
  return Boolean(transformedSize && Number(transformedSize[1]) <= 480 && Number(transformedSize[2]) <= 480);
}

function isProbableAuthorImage(block: ImportedArticleBlock, adjacentTexts: string[]): boolean {
  if (block.type !== "image" || !block.src) return false;
  const identity = normalizedImageIdentity(block);
  if (AUTHOR_IMAGE_NAMESPACE_PATTERN.test(identity)) return true;

  const personName = probablePersonName(block.alt ?? "");
  if (!personName) return false;
  const hasMatchingMetadata = adjacentTexts.some((text) => isMatchingAuthorMetadata(text, personName));
  if (hasMatchingMetadata && isSmallAuthorThumbnail(block, identity)) return true;
  return AUTHOR_IMAGE_KEYWORD_PATTERN.test(identity)
    && (isSmallAuthorThumbnail(block, identity) || hasMatchingMetadata);
}

function isMatchingAuthorMetadata(text: string, personName: string): boolean {
  if (!text) return false;
  const normalized = text.replace(/\s+/g, " ").trim();
  const lowerText = normalized.toLocaleLowerCase();
  const lowerName = personName.toLocaleLowerCase();
  if (lowerName && lowerText === lowerName) return true;
  if (lowerName && lowerText.startsWith(lowerName) && normalized.length <= personName.length + 60 && BYLINE_ROLE_PATTERN.test(normalized)) return true;
  if (lowerName && lowerText.startsWith(`by ${lowerName}`) && normalized.length <= personName.length + 60) return true;
  return false;
}

export function removeAuthorIdentityBlocks(blocks: ImportedArticleBlock[]): ImportedArticleBlock[] {
  const removeIndexes = new Set<number>();

  blocks.forEach((block, index) => {
    if (block.type !== "image") return;
    const previousText = normalizedBlockText(blocks[index - 1] ?? block);
    const nextText = normalizedBlockText(blocks[index + 1] ?? block);
    if (!isProbableAuthorImage(block, [previousText, nextText])) return;

    removeIndexes.add(index);
    const personName = probablePersonName(block.alt ?? "");
    if (isMatchingAuthorMetadata(previousText, personName)) removeIndexes.add(index - 1);
    if (isMatchingAuthorMetadata(nextText, personName)) removeIndexes.add(index + 1);
  });

  return blocks
    .filter((_, index) => !removeIndexes.has(index))
    .map((block, index) => ({ ...block, id: `block-${index}` }));
}

function blocksToText(blocks: ImportedArticleBlock[]): string {
  return blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function hasEnoughArticleContent(substantiveBlocks: number, substantiveCharacters: number): boolean {
  return substantiveBlocks >= 3 && substantiveCharacters >= 400;
}

export function trimTrailingWebsiteBlocks(blocks: ImportedArticleBlock[], baseUrl?: string): ImportedArticleBlock[] {
  let substantiveBlocks = 0;
  let substantiveCharacters = 0;
  let trailingBoundary = blocks.length;
  const publisherPattern = publisherTrailingPattern(baseUrl);

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.type === "image" || block.type === "table") {
      continue;
    }
    const text = normalizedBlockText(block);
    if (hasEnoughArticleContent(substantiveBlocks, substantiveCharacters) && EXPLICIT_END_MARKER_PATTERN.test(text)) {
      trailingBoundary = index;
      break;
    }
    if (
      hasEnoughArticleContent(substantiveBlocks, substantiveCharacters)
      && (TRAILING_SECTION_PATTERN.test(text) || publisherPattern?.test(text))
    ) {
      trailingBoundary = index;
      break;
    }
    if (text.length >= 40) {
      substantiveBlocks += 1;
      substantiveCharacters += text.length;
    }
  }

  return blocks.slice(0, trailingBoundary).map((block, index) => ({ ...block, id: `block-${index}` }));
}

export function trimTrailingWebsiteText(value: string, baseUrl?: string): string {
  const paragraphs = value.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  let substantiveBlocks = 0;
  let substantiveCharacters = 0;
  let trailingBoundary = paragraphs.length;
  const publisherPattern = publisherTrailingPattern(baseUrl);

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index]?.replaceAll("\u00ad", "").replace(/\s+/g, " ").trim() ?? "";
    if (
      hasEnoughArticleContent(substantiveBlocks, substantiveCharacters)
      && (TRAILING_SECTION_PATTERN.test(text) || publisherPattern?.test(text))
    ) {
      trailingBoundary = index;
      break;
    }
    if (text.length >= 40) {
      substantiveBlocks += 1;
      substantiveCharacters += text.length;
    }
  }

  return paragraphs.slice(0, trailingBoundary).join("\n\n").trim();
}

export function sanitizeImportedArticleContent(article: ImportedArticle): ImportedArticle {
  const decodedArticle: ImportedArticle = {
    ...article,
    title: decodeHtmlEntitiesRepeated(article.title),
    text: decodeHtmlEntitiesRepeated(article.text),
    blocks: article.blocks.map(decodeBlockEntities),
  };
  const boundedBlocks = trimTrailingWebsiteBlocks(decodedArticle.blocks, decodedArticle.url);
  const blocks = removeDuplicateImageCaptionBlocks(removeAuthorIdentityBlocks(boundedBlocks));
  return normalizeImportedArticleStructure({
    ...decodedArticle,
    text: blocksToText(blocks) || trimTrailingWebsiteText(decodedArticle.text, decodedArticle.url),
    blocks,
  });
}

export function isRemoteImportedArticle(article: ImportedArticle | null | undefined): article is ImportedArticle {
  if (!article) {
    return false;
  }
  try {
    return ["http:", "https:"].includes(new URL(article.url).protocol);
  } catch {
    return false;
  }
}
