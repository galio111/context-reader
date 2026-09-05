import type {
  ArticleReadingStyle,
  ImportedArticle,
  ImportedArticleBlock,
  ImportedArticleInlineText,
  ImportedArticleTable,
  ImportedArticleTableCell,
  ImportedImageLayoutWord,
  SavedArticle,
} from "@/types/article";
import type { ReaderViewportAnchor } from "@/types/reader";
import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";
import { mergeDuplicateSavedArticles, savedArticleBodyIdentity } from "@/lib/savedArticleMerge";
import { normalizeImportedArticleStructure } from "@/lib/importedArticleNormalization";
import {
  applyArticleReadingStates,
  deleteArticleReadingState,
  updateArticleReadingState,
} from "@/lib/readingState";
import {
  decodeStoredArticles,
  readStoredArticles,
  SAVED_ARTICLES_COMPRESSED_PREFIX,
  SAVED_ARTICLES_STORAGE_KEY,
  writeStoredArticles,
} from "@/lib/articleStorage";

const GENERIC_SUMMARY = "这是一篇已保存的英文阅读文章。";
const MIN_SUMMARY_CHINESE_CHARS = 8;
const READER_TOP_ANCHOR: ReaderViewportAnchor = {
  blockId: "context-reader:top",
  blockIndex: Number.MAX_SAFE_INTEGER,
  blockText: "",
  top: 0,
  scrollY: 0,
  scrollRatio: 0,
};
let cachedArticlesRaw: string | null | undefined;
let cachedArticles: SavedArticle[] | null = null;
const ENCODED_ENTITY_PATTERN = /&(?:amp;)*(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i;

function decodeBrowserHtmlEntities(value: string): string {
  if (typeof document === "undefined" || !ENCODED_ENTITY_PATTERN.test(value)) return value;
  let decoded = value;
  for (let pass = 0; pass < 4 && ENCODED_ENTITY_PATTERN.test(decoded); pass += 1) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = decoded;
    const next = textarea.value;
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const testKey = "context-reader:article-storage-test";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function titleFromArticle(article: string): string {
  const firstLine = article
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || "Untitled Article").slice(0, 80);
}

function normalizeInlineText(value: unknown): ImportedArticleInlineText | null {
  const item = value as Partial<ImportedArticleInlineText>;
  if (!item || typeof item.text !== "string" || !item.text) {
    return null;
  }
  if (item.baseline && item.baseline !== "sup" && item.baseline !== "sub") {
    return null;
  }
  return {
    text: decodeBrowserHtmlEntities(item.text),
    ...(item.baseline ? { baseline: item.baseline } : {}),
  };
}

function normalizeLayoutWord(value: unknown): ImportedImageLayoutWord | null {
  const word = value as Partial<ImportedImageLayoutWord>;
  if (!word || typeof word.text !== "string" || !word.text.trim()) {
    return null;
  }
  if (
    typeof word.x !== "number" ||
    typeof word.y !== "number" ||
    typeof word.width !== "number" ||
    typeof word.height !== "number" ||
    !Number.isFinite(word.x) ||
    !Number.isFinite(word.y) ||
    !Number.isFinite(word.width) ||
    !Number.isFinite(word.height)
  ) {
    return null;
  }
  return {
    text: word.text.trim(),
    x: Math.max(0, Math.min(100, word.x)),
    y: Math.max(0, Math.min(100, word.y)),
    width: Math.max(0, Math.min(100, word.width)),
    height: Math.max(0, Math.min(100, word.height)),
    lineText: typeof word.lineText === "string" && word.lineText.trim() ? word.lineText.trim() : word.text.trim(),
  };
}

function normalizeImportedBlock(value: unknown): ImportedArticleBlock | null {
  const block = value as Partial<ImportedArticleBlock>;
  if (!block || typeof block.type !== "string" || typeof block.id !== "string") {
    return null;
  }

  if (block.type === "image") {
    const src = typeof block.src === "string" ? block.src : "";
    if (!src) {
      return null;
    }
    return {
      id: block.id,
      type: "image",
      src,
      alt: typeof block.alt === "string" ? decodeBrowserHtmlEntities(block.alt) : "",
      ...(typeof block.caption === "string" ? { caption: decodeBrowserHtmlEntities(block.caption) } : {}),
      ...(typeof block.width === "number" && Number.isFinite(block.width) && block.width > 0
        ? { width: block.width }
        : {}),
      ...(typeof block.height === "number" && Number.isFinite(block.height) && block.height > 0
        ? { height: block.height }
        : {}),
      ocrText: typeof block.ocrText === "string" ? block.ocrText : "",
      ...(Array.isArray(block.layoutWords)
        ? {
            layoutWords: block.layoutWords
              .map(normalizeLayoutWord)
              .filter((item): item is ImportedImageLayoutWord => Boolean(item)),
          }
        : {}),
      ...(typeof block.layoutError === "string" ? { layoutError: block.layoutError } : {}),
    };
  }

  if (block.type === "table") {
    const table = normalizeImportedTable(block.table);
    if (!table) {
      return null;
    }
    return {
      id: block.id,
      type: "table",
      text: typeof block.text === "string" ? decodeBrowserHtmlEntities(block.text) : table.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n"),
      table,
    };
  }

  if (
    block.type !== "heading" &&
    block.type !== "subheading" &&
    block.type !== "paragraph" &&
    block.type !== "list-item" &&
    block.type !== "quote" &&
    block.type !== "caption"
  ) {
    return null;
  }

  const text = typeof block.text === "string" ? decodeBrowserHtmlEntities(block.text) : "";
  return {
    id: block.id,
    type: block.type,
    text,
    ...(block.listStyle === "ordered" || block.listStyle === "unordered" ? { listStyle: block.listStyle } : {}),
    ...(typeof block.listLevel === "number" && Number.isFinite(block.listLevel) ? { listLevel: Math.max(0, Math.min(4, Math.floor(block.listLevel))) } : {}),
    ...(typeof block.listOrdinal === "number" && Number.isFinite(block.listOrdinal) ? { listOrdinal: Math.floor(block.listOrdinal) } : {}),
    ...(Array.isArray(block.inline)
      ? {
          inline: block.inline
            .map(normalizeInlineText)
            .filter((item): item is ImportedArticleInlineText => Boolean(item)),
        }
      : {}),
  };
}

function normalizeImportedTableCell(value: unknown): ImportedArticleTableCell | null {
  const cell = value as Partial<ImportedArticleTableCell>;
  if (!cell || typeof cell.text !== "string") {
    return null;
  }
  return {
    text: decodeBrowserHtmlEntities(cell.text).slice(0, 2_000),
    ...(cell.header === true ? { header: true } : {}),
    ...(cell.scope === "row" || cell.scope === "col" ? { scope: cell.scope } : {}),
    ...(typeof cell.rowSpan === "number" && Number.isFinite(cell.rowSpan) && cell.rowSpan > 1
      ? { rowSpan: Math.min(50, Math.floor(cell.rowSpan)) }
      : {}),
    ...(typeof cell.colSpan === "number" && Number.isFinite(cell.colSpan) && cell.colSpan > 1
      ? { colSpan: Math.min(50, Math.floor(cell.colSpan)) }
      : {}),
  };
}

function normalizeImportedTable(value: unknown): ImportedArticleTable | null {
  const table = value as Partial<ImportedArticleTable>;
  if (!table || !Array.isArray(table.rows)) {
    return null;
  }
  const rows = table.rows
    .slice(0, 500)
    .map((row) => Array.isArray(row)
      ? row.slice(0, 40).map(normalizeImportedTableCell).filter((cell): cell is ImportedArticleTableCell => Boolean(cell))
      : [])
    .filter((row) => row.length > 0);
  if (rows.length === 0) {
    return null;
  }
  return {
    ...(typeof table.caption === "string" && table.caption.trim() ? { caption: decodeBrowserHtmlEntities(table.caption.trim()).slice(0, 1_000) } : {}),
    rows,
  };
}

function normalizeArticleStyle(value: unknown): ArticleReadingStyle | undefined {
  const style = value as Partial<ArticleReadingStyle>;
  if (!style || typeof style !== "object") {
    return undefined;
  }

  const nextStyle: ArticleReadingStyle = {};
  if (style.fontFamily === "system" || style.fontFamily === "serif" || style.fontFamily === "mono") {
    nextStyle.fontFamily = style.fontFamily;
  }
  if (style.fontSize === "small" || style.fontSize === "default" || style.fontSize === "large" || style.fontSize === "xlarge") {
    nextStyle.fontSize = style.fontSize;
  }
  if (style.lineHeight === "compact" || style.lineHeight === "default" || style.lineHeight === "relaxed") {
    nextStyle.lineHeight = style.lineHeight;
  }
  if (style.paragraphSpacing === "compact" || style.paragraphSpacing === "default" || style.paragraphSpacing === "relaxed") {
    nextStyle.paragraphSpacing = style.paragraphSpacing;
  }
  if (style.contentWidth === "narrow" || style.contentWidth === "default" || style.contentWidth === "wide") {
    nextStyle.contentWidth = style.contentWidth;
  }
  if (style.imageWidth === "small" || style.imageWidth === "medium" || style.imageWidth === "full") {
    nextStyle.imageWidth = style.imageWidth;
  }

  return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
}

function normalizeImportedArticle(value: unknown, body: string): ImportedArticle | undefined {
  const importedArticle = value as Partial<ImportedArticle>;
  if (!importedArticle || typeof importedArticle !== "object") {
    return undefined;
  }

  const blocks = Array.isArray(importedArticle.blocks)
    ? importedArticle.blocks
        .map(normalizeImportedBlock)
        .filter((block): block is ImportedArticleBlock => Boolean(block))
    : [];

  if (blocks.length === 0) {
    return undefined;
  }

  return normalizeImportedArticleStructure({
    title: typeof importedArticle.title === "string" && importedArticle.title.trim()
      ? decodeBrowserHtmlEntities(importedArticle.title.trim())
      : titleFromArticle(body),
    url: typeof importedArticle.url === "string" ? importedArticle.url : "",
    siteName: typeof importedArticle.siteName === "string" ? decodeBrowserHtmlEntities(importedArticle.siteName) : "",
    text: typeof importedArticle.text === "string" && importedArticle.text.trim()
      ? decodeBrowserHtmlEntities(importedArticle.text)
      : body,
    blocks,
    ...(typeof importedArticle.byline === "string" ? { byline: decodeBrowserHtmlEntities(importedArticle.byline) } : {}),
    ...(typeof importedArticle.publishedTime === "string" ? { publishedTime: importedArticle.publishedTime } : {}),
    ...(typeof importedArticle.language === "string" ? { language: importedArticle.language } : {}),
    ...(normalizeArticleStyle(importedArticle.style) ? { style: normalizeArticleStyle(importedArticle.style) } : {}),
  });
}

function normalizeArticle(value: unknown): SavedArticle | null {
  const article = value as Partial<SavedArticle>;
  if (!article || typeof article.body !== "string" || !article.body.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  const importedArticle = normalizeImportedArticle(article.importedArticle, article.body);
  const candidateProgress = article.readingProgress;
  const readingProgress = candidateProgress
    && typeof candidateProgress.blockId === "string"
    && Number.isFinite(candidateProgress.blockIndex)
    && typeof candidateProgress.blockText === "string"
    && Number.isFinite(candidateProgress.top)
    && Number.isFinite(candidateProgress.scrollY)
    && Number.isFinite(candidateProgress.scrollRatio)
    && typeof candidateProgress.capturedAt === "string"
      ? {
          blockId: candidateProgress.blockId,
          blockIndex: Math.max(0, Math.floor(candidateProgress.blockIndex)),
          blockText: candidateProgress.blockText.slice(0, 120),
          top: candidateProgress.top,
          scrollY: Math.max(0, candidateProgress.scrollY),
          scrollRatio: Math.min(1, Math.max(0, candidateProgress.scrollRatio)),
          capturedAt: candidateProgress.capturedAt,
        }
      : undefined;
  return {
    id: typeof article.id === "string" ? article.id : `article-${Date.now()}`,
    title: typeof article.title === "string" && article.title.trim()
      ? article.title.trim()
      : titleFromArticle(article.body),
    summary: typeof article.summary === "string" ? article.summary : "",
    body: importedArticle?.text || article.body,
    ...(importedArticle ? { importedArticle } : {}),
    createdAt: typeof article.createdAt === "string" ? article.createdAt : now,
    updatedAt: typeof article.updatedAt === "string" ? article.updatedAt : now,
    ...(typeof article.lastOpenedAt === "string" ? { lastOpenedAt: article.lastOpenedAt } : {}),
    ...(readingProgress ? { readingProgress } : {}),
  };
}

export function getSavedArticles(): SavedArticle[] {
  const storage = safeLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(SAVED_ARTICLES_STORAGE_KEY);
    if (!raw) {
      cachedArticlesRaw = raw;
      cachedArticles = [];
      return [];
    }
    if (raw === cachedArticlesRaw && cachedArticles) {
      return applyArticleReadingStates(cachedArticles, storage);
    }
    const serialized = decodeStoredArticles(raw);
    const parsed = readStoredArticles(storage) as unknown[];
    const normalized = parsed
      .map(normalizeArticle)
      .filter((article): article is SavedArticle => Boolean(article));
    const merged = mergeDuplicateSavedArticles(normalized);
    const normalizedRaw = JSON.stringify(merged.articles);
    if (
      merged.removedIds.length
      || normalized.length !== parsed.length
      || normalizedRaw !== serialized
      || !raw.startsWith(SAVED_ARTICLES_COMPRESSED_PREFIX)
    ) {
      cachedArticlesRaw = writeStoredArticles(storage, merged.articles);
      if (merged.removedIds.length) notifyAccountObjectsDeleted("article", merged.removedIds);
      else notifyAccountDataChanged(["article"]);
    } else {
      cachedArticlesRaw = raw;
    }
    cachedArticles = merged.articles;
    return applyArticleReadingStates(cachedArticles, storage);
  } catch {
    cachedArticlesRaw = undefined;
    cachedArticles = null;
    return [];
  }
}

export function saveArticles(articles: SavedArticle[]): void {
  const storage = safeLocalStorage();
  if (!storage) {
    throw new Error("浏览器未开放本机存储，文章无法保存。请允许本站存储后重试。");
  }
  const merged = mergeDuplicateSavedArticles(articles);
  try {
    cachedArticlesRaw = writeStoredArticles(storage, merged.articles);
    cachedArticles = merged.articles;
  } catch (error) {
    cachedArticlesRaw = undefined;
    cachedArticles = null;
    const errorName = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (errorName === "QuotaExceededError" || errorName === "NS_ERROR_DOM_QUOTA_REACHED") {
      throw new Error("浏览器的本机存储空间已满，文章尚未保存。请先同步或删除不需要的本机内容后重试。");
    }
    throw error;
  }
  if (merged.removedIds.length) notifyAccountObjectsDeleted("article", merged.removedIds);
  else notifyAccountDataChanged(["article"]);
}

export function articleIdentity(article: string): string {
  return savedArticleBodyIdentity(article);
}

export function findSavedArticle(article: string): SavedArticle | null {
  const key = articleIdentity(article);
  return getSavedArticles().find((item) => articleIdentity(item.body) === key) ?? null;
}

export function isValidArticleSummary(summary: string): boolean {
  const normalized = summary.trim();
  if (!normalized || normalized === GENERIC_SUMMARY) {
    return false;
  }

  const chineseChars = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return chineseChars >= MIN_SUMMARY_CHINESE_CHARS;
}

export function saveArticle(article: string, summary = "", importedArticle?: ImportedArticle | null): SavedArticle[] {
  const body = article.trim();
  const articles = getSavedArticles();
  const key = articleIdentity(body);
  const existing = articles.find((item) => articleIdentity(item.body) === key);
  const now = new Date().toISOString();
  const normalizedImportedArticle = normalizeImportedArticle(importedArticle, body);

  if (existing) {
    const nextArticles = articles.map((item) =>
      item.id === existing.id
        ? {
            ...item,
            summary: summary || item.summary,
            ...(normalizedImportedArticle ? { importedArticle: normalizedImportedArticle } : {}),
            updatedAt: now,
          }
        : item,
    );
    saveArticles(nextArticles);
    return nextArticles;
  }

  const nextArticles = [
    {
      id: `article-${Date.now()}`,
      title: titleFromArticle(body),
      summary,
      body,
      ...(normalizedImportedArticle ? { importedArticle: normalizedImportedArticle } : {}),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    },
    ...articles,
  ];
  saveArticles(nextArticles);
  return nextArticles;
}

export function saveEditedArticle(
  previousArticle: string,
  nextArticle: string,
  importedArticle?: ImportedArticle | null,
): SavedArticle[] {
  const previousKey = articleIdentity(previousArticle);
  const nextBody = nextArticle.trim();
  const articles = getSavedArticles();
  const existing = articles.find((item) => articleIdentity(item.body) === previousKey);

  if (!existing) {
    return articles;
  }

  const now = new Date().toISOString();
  const normalizedImportedArticle = normalizeImportedArticle(importedArticle, nextBody);
  const nextArticles = articles.map((item) =>
    item.id === existing.id
      ? {
          ...item,
          title: titleFromArticle(nextBody),
          body: nextBody,
          ...(normalizedImportedArticle ? { importedArticle: normalizedImportedArticle } : { importedArticle: undefined }),
          updatedAt: now,
        }
      : item,
  );
  saveArticles(nextArticles);
  return nextArticles;
}

export function replaceSavedArticleImportedArticle(
  id: string,
  importedArticle: ImportedArticle,
): SavedArticle[] {
  const articles = getSavedArticles();
  const existing = articles.find((article) => article.id === id);
  if (!existing) return articles;

  const normalizedImportedArticle = normalizeImportedArticle(importedArticle, existing.body);
  if (!normalizedImportedArticle) return articles;
  const updatedAt = new Date().toISOString();
  const nextArticles = articles.map((article) => article.id === id
    ? { ...article, importedArticle: normalizedImportedArticle, updatedAt }
    : article);
  saveArticles(nextArticles);
  return nextArticles;
}

export function touchSavedArticle(id: string): SavedArticle[] {
  const articles = getSavedArticles();
  const existing = articles.find((article) => article.id === id);
  if (!existing) {
    return articles;
  }

  const openedAt = new Date().toISOString();
  updateArticleReadingState(id, { lastOpenedAt: openedAt });
  const touchedArticle = {
    ...existing,
    lastOpenedAt: openedAt,
  };
  return [
    touchedArticle,
    ...articles.filter((article) => article.id !== id),
  ];
}

export function saveArticleReadingProgress(id: string, anchor: ReaderViewportAnchor): SavedArticle[] {
  const articles = getSavedArticles();
  const existing = articles.find((article) => article.id === id);
  if (!existing) {
    return articles;
  }

  const normalizedScrollRatio = Math.min(1, Math.max(0, anchor.scrollRatio));
  const existingScrollRatio = existing.readingProgress?.scrollRatio ?? -1;
  if (normalizedScrollRatio + 0.01 < existingScrollRatio) {
    return articles;
  }

  const state = updateArticleReadingState(id, { readingProgress: { ...anchor, scrollRatio: normalizedScrollRatio } });
  if (!state?.readingProgress) return articles;
  return articles.map((article) => article.id === id
    ? { ...article, readingProgress: state.readingProgress, lastOpenedAt: state.lastOpenedAt }
    : article);
}

export function resetArticleReadingProgress(id: string): SavedArticle[] {
  const articles = getSavedArticles();
  const existing = articles.find((article) => article.id === id);
  if (!existing) return articles;
  const state = updateArticleReadingState(id, { readingProgress: READER_TOP_ANCHOR });
  if (!state?.readingProgress) return articles;
  return articles.map((article) => article.id === id
    ? { ...article, readingProgress: state.readingProgress, lastOpenedAt: state.lastOpenedAt }
    : article);
}

export function deleteSavedArticle(id: string): SavedArticle[] {
  const articles = getSavedArticles();
  const nextArticles = articles.filter((article) => article.id !== id);
  if (nextArticles.length !== articles.length) {
    deleteArticleReadingState(id);
    notifyAccountObjectsDeleted("article", [id]);
  }
  saveArticles(nextArticles);
  return nextArticles;
}
