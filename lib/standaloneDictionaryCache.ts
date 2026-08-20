"use client";

import LZString from "lz-string";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
import { normalizeDictionarySpelling } from "@/lib/dictionarySpelling";
import { normalizeStandaloneDictionaryQuery } from "@/lib/standaloneDictionaryHistory";
import type { DictionaryResult } from "@/types/dictionary";

export const STANDALONE_DICTIONARY_CACHE_KEY = "context-reader:standalone-dictionary-cache:v2";
export const STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX = "standalone-dictionary-cache:";

const COMPRESSED_PREFIX = "lz-utf16:";
const MAX_CACHE_ENTRIES = 80;
let runtimeCache: StandaloneDictionaryCacheItem[] = [];

export interface StandaloneDictionaryCacheItem {
  schemaVersion: 2;
  query: string;
  normalizedQuery: string;
  result: DictionaryResult;
  updatedAt: string;
}

export function normalizeStandaloneDictionaryCacheItem(
  value: unknown,
): StandaloneDictionaryCacheItem | null {
  const item = value as Partial<StandaloneDictionaryCacheItem>;
  if (
    !item
    || item.schemaVersion !== 2
    || typeof item.query !== "string"
    || typeof item.updatedAt !== "string"
    || !item.result
    || typeof item.result !== "object"
  ) {
    return null;
  }
  const query = item.query.trim().replace(/\s+/g, " ");
  const normalizedQuery = normalizeStandaloneDictionaryQuery(
    typeof item.normalizedQuery === "string" ? item.normalizedQuery : query,
  );
  if (!query || !normalizedQuery || !Number.isFinite(Date.parse(item.updatedAt))) {
    return null;
  }
  const result = normalizeDictionarySpelling(item.result, query);
  if (
    result.inputStatus === "misspelled"
    || !result.senses?.length
    || !Array.isArray(result.collocations)
    || !Array.isArray(result.wordFamily)
    || !Array.isArray(result.synonyms)
    || !Array.isArray(result.commonMistakes)
  ) {
    return null;
  }
  return { schemaVersion: 2, query, normalizedQuery, result, updatedAt: item.updatedAt };
}

function sortAndDeduplicate(values: unknown[]): StandaloneDictionaryCacheItem[] {
  const byQuery = new Map<string, StandaloneDictionaryCacheItem>();
  for (const value of values) {
    const item = normalizeStandaloneDictionaryCacheItem(value);
    if (!item) continue;
    const existing = byQuery.get(item.normalizedQuery);
    if (!existing || Date.parse(item.updatedAt) > Date.parse(existing.updatedAt)) {
      byQuery.set(item.normalizedQuery, item);
    }
  }
  return Array.from(byQuery.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_CACHE_ENTRIES);
}

function deserialize(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const serialized = raw.startsWith(COMPRESSED_PREFIX)
      ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length))
      : raw;
    const value = JSON.parse(serialized || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function readStandaloneDictionaryCache(
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): StandaloneDictionaryCacheItem[] {
  if (!storage) return runtimeCache;
  try {
    return sortAndDeduplicate([
      ...runtimeCache,
      ...deserialize(storage.getItem(STANDALONE_DICTIONARY_CACHE_KEY)),
    ]);
  } catch {
    return runtimeCache;
  }
}

export function writeStandaloneDictionaryCache(
  storage: Storage,
  items: StandaloneDictionaryCacheItem[],
): void {
  const next = sortAndDeduplicate(items);
  runtimeCache = next;
  const persist = (values: StandaloneDictionaryCacheItem[]) => {
    const serialized = JSON.stringify(values);
    storage.setItem(
      STANDALONE_DICTIONARY_CACHE_KEY,
      `${COMPRESSED_PREFIX}${LZString.compressToUTF16(serialized)}`,
    );
  };
  try {
    persist(next);
    return;
  } catch {
    // Keep the full runtime copy for account sync, then reclaim only this cache key.
  }
  try {
    storage.removeItem(STANDALONE_DICTIONARY_CACHE_KEY);
  } catch {
    return;
  }
  for (const limit of [40, 20, 10, 5, 2, 1]) {
    try {
      persist(next.slice(0, limit));
      return;
    } catch {
      // Try a smaller local replay window; the complete runtime copy still syncs.
    }
  }
}

export function clearStandaloneDictionaryRuntimeCache(): void {
  runtimeCache = [];
}

export function recordStandaloneDictionaryCache(
  result: DictionaryResult,
): StandaloneDictionaryCacheItem[] {
  if (typeof window === "undefined" || result.inputStatus === "misspelled") return [];
  const query = result.query.trim().replace(/\s+/g, " ");
  const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
  if (!normalizedQuery) return readStandaloneDictionaryCache();
  const next = sortAndDeduplicate([
    { schemaVersion: 2, query, normalizedQuery, result, updatedAt: new Date().toISOString() },
    ...readStandaloneDictionaryCache(),
  ]);
  writeStandaloneDictionaryCache(window.localStorage, next);
  notifyAccountDataChanged();
  return next;
}

export function migrateStandaloneDictionarySessionCache(
  results: DictionaryResult[],
): StandaloneDictionaryCacheItem[] {
  if (typeof window === "undefined") return [];
  const existing = readStandaloneDictionaryCache();
  const existingQueries = new Set(existing.map((item) => item.normalizedQuery));
  const missing: StandaloneDictionaryCacheItem[] = [];
  const baseTime = Date.now();
  for (const [index, rawResult] of results.entries()) {
    const result = normalizeDictionarySpelling(rawResult);
    const query = result.query.trim().replace(/\s+/g, " ");
    const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
    if (
      !normalizedQuery
      || existingQueries.has(normalizedQuery)
      || result.inputStatus === "misspelled"
      || !result.senses?.length
    ) {
      continue;
    }
    existingQueries.add(normalizedQuery);
    missing.push({
      schemaVersion: 2,
      query,
      normalizedQuery,
      result,
      updatedAt: new Date(baseTime - (results.length - index) * 1_000).toISOString(),
    });
  }
  if (missing.length === 0) return existing;
  const next = sortAndDeduplicate([...missing, ...existing]);
  writeStandaloneDictionaryCache(window.localStorage, next);
  notifyAccountDataChanged();
  return next;
}

export function standaloneDictionaryCacheObjectKey(
  item: Pick<StandaloneDictionaryCacheItem, "normalizedQuery">,
): string {
  return `${STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX}${encodeURIComponent(item.normalizedQuery)}`;
}

export function isStandaloneDictionaryCacheObjectKey(objectKey: string): boolean {
  return objectKey.startsWith(STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX);
}
