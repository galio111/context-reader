import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";

const TRAILING_SECTION_PATTERN = /^(?:related\s+(?:topics?|terms?|stories|articles|content)|story\s+source|journal\s+references?|cite\s+this\s+page|explore\s+more|recommended(?:\s+for\s+you)?|you\s+(?:may|might)\s+also\s+like|read\s+next|more\s+(?:stories|articles|from)|most\s+popular|trending|about\s+the\s+author|sign\s+up\s+for\b|advertisement)\b/i;
const EXPLICIT_END_MARKER_PATTERN = /^[-–—]?\s*end\s*[-–—]?\.?$/i;

function normalizedBlockText(block: ImportedArticleBlock): string {
  return block.text?.replace(/\s+/g, " ").trim() ?? "";
}

function hasEnoughArticleContent(substantiveBlocks: number, substantiveCharacters: number): boolean {
  return substantiveBlocks >= 3 && substantiveCharacters >= 400;
}

export function trimTrailingWebsiteBlocks(blocks: ImportedArticleBlock[]): ImportedArticleBlock[] {
  let substantiveBlocks = 0;
  let substantiveCharacters = 0;
  let trailingBoundary = blocks.length;

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
    if (hasEnoughArticleContent(substantiveBlocks, substantiveCharacters) && TRAILING_SECTION_PATTERN.test(text)) {
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

export function trimTrailingWebsiteText(value: string): string {
  const paragraphs = value.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  let substantiveBlocks = 0;
  let substantiveCharacters = 0;
  let trailingBoundary = paragraphs.length;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index]?.replace(/\s+/g, " ").trim() ?? "";
    if (hasEnoughArticleContent(substantiveBlocks, substantiveCharacters) && TRAILING_SECTION_PATTERN.test(text)) {
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
  return {
    ...article,
    text: trimTrailingWebsiteText(article.text),
    blocks: trimTrailingWebsiteBlocks(article.blocks),
  };
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
