"use client";

import LZString from "lz-string";
import type { SavedArticle } from "@/types/article";

export const SAVED_ARTICLES_STORAGE_KEY = "context-reader:articles:v1";
export const SAVED_ARTICLES_COMPRESSED_PREFIX = "lz-utf16:";

export function decodeStoredArticles(raw: string | null): string {
  if (!raw) return "";
  if (!raw.startsWith(SAVED_ARTICLES_COMPRESSED_PREFIX)) return raw;
  return LZString.decompressFromUTF16(raw.slice(SAVED_ARTICLES_COMPRESSED_PREFIX.length)) || "";
}

export function readStoredArticles(storage: Storage): SavedArticle[] {
  const serialized = decodeStoredArticles(storage.getItem(SAVED_ARTICLES_STORAGE_KEY));
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return Array.isArray(parsed) ? parsed as SavedArticle[] : [];
  } catch {
    return [];
  }
}

export function serializeStoredArticles(articles: SavedArticle[]): string {
  return `${SAVED_ARTICLES_COMPRESSED_PREFIX}${LZString.compressToUTF16(JSON.stringify(articles))}`;
}

export function writeStoredArticles(storage: Storage, articles: SavedArticle[]): string {
  const raw = serializeStoredArticles(articles);
  storage.setItem(SAVED_ARTICLES_STORAGE_KEY, raw);
  return raw;
}
