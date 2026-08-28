"use client";

import LZString from "lz-string";
import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";

export const STANDALONE_DICTIONARY_HISTORY_KEY = "context-reader:standalone-dictionary-history:v1";
export const STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX = "standalone-dictionary-history:";

const COMPRESSED_PREFIX = "lz-utf16:";

export interface StandaloneDictionaryHistoryItem {
  query: string;
  normalizedQuery: string;
  lastLookedUpAt: string;
}

export function normalizeStandaloneDictionaryQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("en");
}

export function normalizeStandaloneDictionaryHistoryItem(
  value: unknown,
): StandaloneDictionaryHistoryItem | null {
  const item = value as Partial<StandaloneDictionaryHistoryItem>;
  if (!item || typeof item.query !== "string" || typeof item.lastLookedUpAt !== "string") {
    return null;
  }
  const query = item.query.trim().replace(/\s+/g, " ");
  const normalizedQuery = normalizeStandaloneDictionaryQuery(
    typeof item.normalizedQuery === "string" ? item.normalizedQuery : query,
  );
  if (!query || !normalizedQuery || !Number.isFinite(Date.parse(item.lastLookedUpAt))) {
    return null;
  }
  return { query, normalizedQuery, lastLookedUpAt: item.lastLookedUpAt };
}

function serializeHistory(items: StandaloneDictionaryHistoryItem[]): string {
  return `${COMPRESSED_PREFIX}${LZString.compressToUTF16(JSON.stringify(items))}`;
}

function deserializeHistory(raw: string | null): unknown[] {
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

export function sortAndDeduplicateStandaloneDictionaryHistory(
  values: unknown[],
): StandaloneDictionaryHistoryItem[] {
  const byQuery = new Map<string, StandaloneDictionaryHistoryItem>();
  for (const value of values) {
    const item = normalizeStandaloneDictionaryHistoryItem(value);
    if (!item) continue;
    const existing = byQuery.get(item.normalizedQuery);
    if (!existing || Date.parse(item.lastLookedUpAt) > Date.parse(existing.lastLookedUpAt)) {
      byQuery.set(item.normalizedQuery, item);
    }
  }
  return Array.from(byQuery.values()).sort(
    (left, right) => Date.parse(right.lastLookedUpAt) - Date.parse(left.lastLookedUpAt),
  );
}

export function readStandaloneDictionaryHistory(
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
): StandaloneDictionaryHistoryItem[] {
  if (!storage) return [];
  try {
    return sortAndDeduplicateStandaloneDictionaryHistory(
      deserializeHistory(storage.getItem(STANDALONE_DICTIONARY_HISTORY_KEY)),
    );
  } catch {
    return [];
  }
}

export function writeStandaloneDictionaryHistory(
  storage: Storage,
  items: StandaloneDictionaryHistoryItem[],
): void {
  storage.setItem(
    STANDALONE_DICTIONARY_HISTORY_KEY,
    serializeHistory(sortAndDeduplicateStandaloneDictionaryHistory(items)),
  );
}

export function recordStandaloneDictionaryHistory(query: string): StandaloneDictionaryHistoryItem[] {
  if (typeof window === "undefined") return [];
  const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
  if (!normalizedQuery) return readStandaloneDictionaryHistory();
  const next = sortAndDeduplicateStandaloneDictionaryHistory([
    {
      query: query.trim().replace(/\s+/g, " "),
      normalizedQuery,
      lastLookedUpAt: new Date().toISOString(),
    },
    ...readStandaloneDictionaryHistory(),
  ]);
  try {
    writeStandaloneDictionaryHistory(window.localStorage, next);
    notifyAccountDataChanged(["preferences"]);
  } catch {
    // History persistence must never block a successful dictionary lookup.
  }
  return next;
}

export function migrateStandaloneDictionarySessionHistory(
  queries: string[],
): StandaloneDictionaryHistoryItem[] {
  if (typeof window === "undefined") return [];
  const existing = readStandaloneDictionaryHistory();
  const existingQueries = new Set(existing.map((item) => item.normalizedQuery));
  const missing: StandaloneDictionaryHistoryItem[] = [];
  const baseTime = Date.now();
  for (const [index, rawQuery] of queries.entries()) {
    const query = rawQuery.trim().replace(/\s+/g, " ");
    const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
    if (!normalizedQuery || existingQueries.has(normalizedQuery)) continue;
    existingQueries.add(normalizedQuery);
    missing.push({
      query,
      normalizedQuery,
      lastLookedUpAt: new Date(baseTime - (queries.length - index) * 1_000).toISOString(),
    });
  }
  if (missing.length === 0) return existing;
  const next = sortAndDeduplicateStandaloneDictionaryHistory([...missing, ...existing]);
  try {
    writeStandaloneDictionaryHistory(window.localStorage, next);
    notifyAccountDataChanged(["preferences"]);
  } catch {
    // Legacy session migration is best effort.
  }
  return next;
}

export function removeStandaloneDictionaryHistory(query: string): StandaloneDictionaryHistoryItem[] {
  if (typeof window === "undefined") return [];
  const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
  const next = readStandaloneDictionaryHistory().filter(
    (item) => item.normalizedQuery !== normalizedQuery,
  );
  try {
    writeStandaloneDictionaryHistory(window.localStorage, next);
    if (normalizedQuery) {
      notifyAccountObjectsDeleted("preferences", [
        standaloneDictionaryHistoryObjectKey({ normalizedQuery }),
      ]);
    }
  } catch {
    // Invalid-history cleanup must not block the correction flow.
  }
  return next;
}

export function standaloneDictionaryHistoryObjectKey(
  item: Pick<StandaloneDictionaryHistoryItem, "normalizedQuery">,
): string {
  return `${STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX}${encodeURIComponent(item.normalizedQuery)}`;
}

export function isStandaloneDictionaryHistoryObjectKey(objectKey: string): boolean {
  return objectKey.startsWith(STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX);
}
