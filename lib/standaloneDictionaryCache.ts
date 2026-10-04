"use client";

import LZString from "lz-string";
import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
import type { DictionaryResult } from "@/types/dictionary";
import {
  normalizeDictionaryQuery,
  normalizeStandaloneDictionaryCacheItem, type StandaloneDictionaryCacheItem,
} from "./dictionaryResultSnapshot";
export {
  STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX,
  normalizeStandaloneDictionaryCacheItem, standaloneDictionaryCacheObjectKey,
  isStandaloneDictionaryCacheObjectKey, type StandaloneDictionaryCacheItem,
} from "./dictionaryResultSnapshot";

export const STANDALONE_DICTIONARY_CACHE_KEY = "context-reader:standalone-dictionary-cache:v2";

function deserialize(raw: string | null): unknown[] {
  if (!raw) return [];
  const value = JSON.parse(raw.startsWith("lz-utf16:")
    ? LZString.decompressFromUTF16(raw.slice(9)) || "[]" : raw);
  return Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
}

function deduplicate(values: unknown[]): StandaloneDictionaryCacheItem[] {
  const items = new Map<string, StandaloneDictionaryCacheItem>();
  for (const value of values) {
    const item = normalizeStandaloneDictionaryCacheItem(value);
    if (item && (!items.has(item.normalizedQuery)
      || item.updatedAt > items.get(item.normalizedQuery)!.updatedAt)) items.set(item.normalizedQuery, item);
  }
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readStandaloneDictionaryCache(
  storage: Storage | null = typeof window === "undefined" ? null : getLearningStorage(),
): StandaloneDictionaryCacheItem[] {
  if (!storage) return [];
  return deduplicate(isLearningStorage(storage)
    ? storage.getRecords(STANDALONE_DICTIONARY_CACHE_KEY)
    : deserialize(storage.getItem(STANDALONE_DICTIONARY_CACHE_KEY)));
}

// Replay reads one row; no full-history decode, compression or sorting.
export function findStandaloneDictionaryCache(query: string, storage: Storage = getLearningStorage()): DictionaryResult | null {
  const key = normalizeDictionaryQuery(query);
  if (isLearningStorage(storage)) {
    return normalizeStandaloneDictionaryCacheItem(storage.getRecord(STANDALONE_DICTIONARY_CACHE_KEY, key))?.result ?? null;
  }
  return readStandaloneDictionaryCache(storage).find(item => item.normalizedQuery === key)?.result ?? null;
}

export function writeStandaloneDictionaryCache(storage: Storage, values: StandaloneDictionaryCacheItem[]): void {
  const items = deduplicate(values);
  storage.setItem(STANDALONE_DICTIONARY_CACHE_KEY, JSON.stringify(Object.fromEntries(items.map(item => [item.normalizedQuery, item]))));
}

// Kept for account-switch compatibility. LearningStorage owns the data.
export function clearStandaloneDictionaryRuntimeCache(): void {}

export function recordStandaloneDictionaryCache(result: DictionaryResult): void {
  const item = normalizeStandaloneDictionaryCacheItem({
    schemaVersion: 2, query: result.query, result, updatedAt: new Date().toISOString(),
  });
  if (!item) return;
  const storage = getLearningStorage();
  if (isLearningStorage(storage)) storage.setRecord(STANDALONE_DICTIONARY_CACHE_KEY, item.normalizedQuery, item);
  else writeStandaloneDictionaryCache(storage, [item, ...readStandaloneDictionaryCache(storage)]);
  notifyAccountDataChanged(["preferences"]);
}

export function migrateStandaloneDictionarySessionCache(results: DictionaryResult[]): void {
  for (const result of results) {
    if (!findStandaloneDictionaryCache(result.query)) recordStandaloneDictionaryCache(result);
  }
}
