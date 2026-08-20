"use client";

import type { ImportedArticle } from "@/types/article";
import type { ReaderReadingProgress, ReaderViewportAnchor } from "@/types/reader";

const TEMPORARY_READING_PREFIX = "context-reader:temporary-reading:v1:";

export interface TemporaryReading {
  id: string;
  title: string;
  body: string;
  importedArticle: ImportedArticle | null;
  updatedAt: string;
  readingProgress: ReaderReadingProgress | null;
}

function storageKey(userId: string): string {
  return `${TEMPORARY_READING_PREFIX}${encodeURIComponent(userId)}`;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function titleFromBody(body: string): string {
  return (body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "未命名文章").slice(0, 100);
}

export function readTemporaryReading(userId: string): TemporaryReading | null {
  const storage = safeStorage();
  if (!storage || !userId) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKey(userId)) || "null") as Partial<TemporaryReading> | null;
    if (!value || typeof value.body !== "string" || !value.body.trim() || typeof value.updatedAt !== "string") return null;
    return {
      id: typeof value.id === "string" && value.id ? value.id : `temporary-${userId}`,
      title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : titleFromBody(value.body),
      body: value.body,
      importedArticle: value.importedArticle && typeof value.importedArticle === "object" ? value.importedArticle : null,
      updatedAt: value.updatedAt,
      readingProgress: value.readingProgress && typeof value.readingProgress === "object" ? value.readingProgress : null,
    };
  } catch {
    return null;
  }
}

export function writeTemporaryReading(
  userId: string,
  body: string,
  importedArticle: ImportedArticle | null,
  readingProgress: ReaderViewportAnchor | ReaderReadingProgress | null = null,
): TemporaryReading | null {
  const storage = safeStorage();
  const trimmedBody = body.trim();
  if (!storage || !userId || !trimmedBody) return null;
  const record: TemporaryReading = {
    id: `temporary-${userId}`,
    title: importedArticle?.title?.trim() || titleFromBody(trimmedBody),
    body: trimmedBody,
    importedArticle,
    updatedAt: new Date().toISOString(),
    readingProgress: readingProgress ? {
      ...readingProgress,
      blockIndex: Math.max(0, Math.floor(readingProgress.blockIndex)),
      blockText: readingProgress.blockText.slice(0, 120),
      scrollY: Math.max(0, readingProgress.scrollY),
      scrollRatio: Math.min(1, Math.max(0, readingProgress.scrollRatio)),
      capturedAt: "capturedAt" in readingProgress ? readingProgress.capturedAt : new Date().toISOString(),
    } : null,
  };
  storage.setItem(storageKey(userId), JSON.stringify(record));
  return record;
}

export function updateTemporaryReadingProgress(userId: string, readingProgress: ReaderViewportAnchor): TemporaryReading | null {
  const current = readTemporaryReading(userId);
  if (!current) return null;
  return writeTemporaryReading(userId, current.body, current.importedArticle, readingProgress);
}

export function clearTemporaryReading(userId: string): void {
  const storage = safeStorage();
  if (storage && userId) storage.removeItem(storageKey(userId));
}
