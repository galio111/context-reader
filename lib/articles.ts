import type { SavedArticle } from "@/types/article";

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

function normalizeArticle(value: unknown): SavedArticle | null {
  const article = value as Partial<SavedArticle>;
  if (!article || typeof article.body !== "string" || !article.body.trim()) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: typeof article.id === "string" ? article.id : `article-${Date.now()}`,
    title: typeof article.title === "string" && article.title.trim()
      ? article.title.trim()
      : titleFromArticle(article.body),
    summary: typeof article.summary === "string" ? article.summary : "",
    body: article.body,
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

export function saveArticle(article: string, summary = ""): SavedArticle[] {
  const body = article.trim();
  const articles = getSavedArticles();
  const key = articleIdentity(body);
  const existing = articles.find((item) => articleIdentity(item.body) === key);
  const now = new Date().toISOString();

  if (existing) {
    const nextArticles = articles.map((item) =>
      item.id === existing.id ? { ...item, summary: summary || item.summary, updatedAt: now } : item,
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
