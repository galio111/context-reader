import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";
import type { SavedArticle } from "@/types/article";
import type { ArticleReadingState, ReaderReadingProgress, ReaderViewportAnchor } from "@/types/reader";

export const READING_STATES_KEY = "context-reader:reading-states:v1";

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeReadingProgress(value: unknown): ReaderReadingProgress | undefined {
  const progress = value as Partial<ReaderReadingProgress>;
  if (
    !progress
    || typeof progress.blockId !== "string"
    || !Number.isFinite(progress.blockIndex)
    || typeof progress.blockText !== "string"
    || !Number.isFinite(progress.top)
    || !Number.isFinite(progress.scrollY)
    || !Number.isFinite(progress.scrollRatio)
    || typeof progress.capturedAt !== "string"
  ) return undefined;
  return {
    blockId: progress.blockId,
    blockIndex: Math.max(0, Math.floor(Number(progress.blockIndex))),
    blockText: progress.blockText.slice(0, 120),
    top: Number(progress.top),
    scrollY: Math.max(0, Number(progress.scrollY)),
    scrollRatio: Math.min(1, Math.max(0, Number(progress.scrollRatio))),
    capturedAt: progress.capturedAt,
  };
}

export function normalizeArticleReadingState(value: unknown): ArticleReadingState | null {
  const state = value as Partial<ArticleReadingState>;
  if (!state || typeof state.articleId !== "string" || !state.articleId) return null;
  const updatedAt = typeof state.updatedAt === "string" ? state.updatedAt : "";
  const lastOpenedAt = typeof state.lastOpenedAt === "string" ? state.lastOpenedAt : updatedAt;
  if (!updatedAt || !lastOpenedAt) return null;
  const readingProgress = normalizeReadingProgress(state.readingProgress);
  return {
    articleId: state.articleId,
    lastOpenedAt,
    updatedAt,
    ...(readingProgress ? { readingProgress } : {}),
  };
}

export function readArticleReadingStates(storage: Storage = window.localStorage): Record<string, ArticleReadingState> {
  try {
    const raw = storage.getItem(READING_STATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([articleId, value]) => normalizeArticleReadingState({
          ...(value && typeof value === "object" ? value : {}),
          articleId,
        }))
        .filter((state): state is ArticleReadingState => Boolean(state))
        .map((state) => [state.articleId, state]),
    );
  } catch {
    return {};
  }
}

export function writeArticleReadingStates(
  storage: Storage,
  states: Record<string, ArticleReadingState>,
  options: { notify?: boolean } = {},
): void {
  storage.setItem(READING_STATES_KEY, JSON.stringify(states));
  if (options.notify !== false) notifyAccountDataChanged(["reading_state"]);
}

export function updateArticleReadingState(
  articleId: string,
  patch: { lastOpenedAt?: string; readingProgress?: ReaderViewportAnchor },
  storage: Storage = window.localStorage,
): ArticleReadingState | null {
  if (!articleId) return null;
  const states = readArticleReadingStates(storage);
  const previous = states[articleId];
  const now = new Date().toISOString();
  const capturedAt = patch.readingProgress ? now : previous?.readingProgress?.capturedAt;
  const readingProgress = patch.readingProgress
    ? normalizeReadingProgress({ ...patch.readingProgress, capturedAt })
    : previous?.readingProgress;
  const next: ArticleReadingState = {
    articleId,
    lastOpenedAt: patch.lastOpenedAt || (patch.readingProgress ? now : previous?.lastOpenedAt) || now,
    updatedAt: now,
    ...(readingProgress ? { readingProgress } : {}),
  };
  writeArticleReadingStates(storage, { ...states, [articleId]: next });
  return next;
}

export function deleteArticleReadingState(articleId: string, storage: Storage = window.localStorage): void {
  const states = readArticleReadingStates(storage);
  if (!states[articleId]) return;
  delete states[articleId];
  writeArticleReadingStates(storage, states, { notify: false });
  notifyAccountObjectsDeleted("reading_state", [articleId]);
}

export function applyArticleReadingStates(
  articles: SavedArticle[],
  storage: Storage = window.localStorage,
): SavedArticle[] {
  const states = readArticleReadingStates(storage);
  return articles
    .map((article) => {
      const state = states[article.id];
      if (!state) return article;
      const existingProgressAt = timestamp(article.readingProgress?.capturedAt);
      const stateProgressAt = timestamp(state.readingProgress?.capturedAt);
      return {
        ...article,
        lastOpenedAt: timestamp(state.lastOpenedAt) >= timestamp(article.lastOpenedAt)
          ? state.lastOpenedAt
          : article.lastOpenedAt,
        ...(state.readingProgress && stateProgressAt >= existingProgressAt
          ? { readingProgress: state.readingProgress }
          : {}),
      };
    })
    .sort((left, right) => timestamp(right.lastOpenedAt || right.updatedAt) - timestamp(left.lastOpenedAt || left.updatedAt));
}
