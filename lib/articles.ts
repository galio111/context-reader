import type { ImportedArticle, ImportedArticleBlock, ImportedArticleInlineText, SavedArticle } from "@/types/article";

const ARTICLES_KEY = "context-reader:articles:v1";
const GENERIC_SUMMARY = "这是一篇已保存的英文阅读文章。";
const MIN_SUMMARY_CHINESE_CHARS = 8;

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
    text: item.text,
    ...(item.baseline ? { baseline: item.baseline } : {}),
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
      alt: typeof block.alt === "string" ? block.alt : "",
      ocrText: typeof block.ocrText === "string" ? block.ocrText : "",
    };
  }

  if (
    block.type !== "heading" &&
    block.type !== "subheading" &&
    block.type !== "paragraph" &&
    block.type !== "list-item" &&
    block.type !== "quote"
  ) {
    return null;
  }

  const text = typeof block.text === "string" ? block.text : "";
  if (!text.trim()) {
    return null;
  }
  return {
    id: block.id,
    type: block.type,
    text,
    ...(Array.isArray(block.inline)
      ? {
          inline: block.inline
            .map(normalizeInlineText)
            .filter((item): item is ImportedArticleInlineText => Boolean(item)),
        }
      : {}),
  };
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

  return {
    title: typeof importedArticle.title === "string" && importedArticle.title.trim()
      ? importedArticle.title.trim()
      : titleFromArticle(body),
    url: typeof importedArticle.url === "string" ? importedArticle.url : "",
    siteName: typeof importedArticle.siteName === "string" ? importedArticle.siteName : "",
    text: typeof importedArticle.text === "string" && importedArticle.text.trim()
      ? importedArticle.text
      : body,
    blocks,
  };
}

function normalizeArticle(value: unknown): SavedArticle | null {
  const article = value as Partial<SavedArticle>;
  if (!article || typeof article.body !== "string" || !article.body.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  const importedArticle = normalizeImportedArticle(article.importedArticle, article.body);
  return {
    id: typeof article.id === "string" ? article.id : `article-${Date.now()}`,
    title: typeof article.title === "string" && article.title.trim()
      ? article.title.trim()
      : titleFromArticle(article.body),
    summary: typeof article.summary === "string" ? article.summary : "",
    body: article.body,
    ...(importedArticle ? { importedArticle } : {}),
    createdAt: typeof article.createdAt === "string" ? article.createdAt : now,
    updatedAt: typeof article.updatedAt === "string" ? article.updatedAt : now,
  };
}

export function getSavedArticles(): SavedArticle[] {
  const storage = safeLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(ARTICLES_KEY);
    if (!raw) {
      return [];
    }
    return (JSON.parse(raw) as unknown[])
      .map(normalizeArticle)
      .filter((article): article is SavedArticle => Boolean(article));
  } catch {
    return [];
  }
}

export function saveArticles(articles: SavedArticle[]): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }
  storage.setItem(ARTICLES_KEY, JSON.stringify(articles));
}

export function articleIdentity(article: string): string {
  return article.trim().replace(/\s+/g, " ").toLowerCase();
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
    },
    ...articles,
  ];
  saveArticles(nextArticles);
  return nextArticles;
}

export function deleteSavedArticle(id: string): SavedArticle[] {
  const nextArticles = getSavedArticles().filter((article) => article.id !== id);
  saveArticles(nextArticles);
  return nextArticles;
}
