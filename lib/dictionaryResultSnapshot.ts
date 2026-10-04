import { normalizeDictionarySpelling } from "./dictionarySpelling";
import type { DictionaryResult } from "../types/dictionary";

export const STANDALONE_DICTIONARY_CACHE_KEY = "context-reader:standalone-dictionary-cache:v2";
export const STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX = "standalone-dictionary-cache:";

export function normalizeDictionaryQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("en");
}

export interface StandaloneDictionaryCacheItem {
  schemaVersion: 2;
  query: string;
  normalizedQuery: string;
  result: DictionaryResult;
  updatedAt: string;
}

export function normalizeStandaloneDictionaryCacheItem(value: unknown): StandaloneDictionaryCacheItem | null {
  const item = value as Partial<StandaloneDictionaryCacheItem>;
  if (!item || item.schemaVersion !== 2 || typeof item.query !== "string"
    || typeof item.updatedAt !== "string" || !item.result || typeof item.result !== "object") return null;
  const query = item.query.trim().replace(/\s+/g, " ");
  const normalizedQuery = normalizeDictionaryQuery(query);
  if (!normalizedQuery || !Number.isFinite(Date.parse(item.updatedAt))
    || normalizeDictionaryQuery(item.result.query || query) !== normalizedQuery) return null;
  const result = normalizeDictionarySpelling(item.result, query);
  if (result.inputStatus === "misspelled" || !result.senses?.length
    || !Array.isArray(result.collocations) || !Array.isArray(result.wordFamily)
    || !Array.isArray(result.synonyms) || !Array.isArray(result.commonMistakes)) return null;
  return { schemaVersion: 2, query, normalizedQuery, result, updatedAt: item.updatedAt };
}

export function standaloneDictionaryCacheObjectKey(item: Pick<StandaloneDictionaryCacheItem, "normalizedQuery">): string {
  return STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX + encodeURIComponent(item.normalizedQuery);
}

export function isStandaloneDictionaryCacheObjectKey(objectKey: string): boolean {
  return objectKey.startsWith(STANDALONE_DICTIONARY_CACHE_OBJECT_PREFIX);
}
