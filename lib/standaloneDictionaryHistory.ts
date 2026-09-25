"use client";

import { getLearningStorage, flushLearningStorage } from "@/lib/learningStorage";

import LZString from "lz-string";
import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";

export const STANDALONE_DICTIONARY_HISTORY_KEY = "context-reader:standalone-dictionary-history:v1";
export const STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX = "standalone-dictionary-history:";

const COMPRESSED_PREFIX = "lz-utf16:";

export const DICTIONARY_HISTORY_EVENTS_KEY = "context-reader:dictionary-history-events:v1";
export const DICTIONARY_HISTORY_EVENT_PREFIX = "dictionary-history-event:v1:";
export const DICTIONARY_HISTORY_MIGRATIONS_KEY = "context-reader:dictionary-history-migrations:v1";
export interface DictionaryHistoryEvent {
  id: string; kind: "query" | "delete"; query: string; normalizedQuery: string;
  at: string; observedDeletes: string[];
}
export interface DictionaryQueryIntent { owner: string; event: DictionaryHistoryEvent }
export function dictionaryHistoryOwner(storage: Storage = getLearningStorage()): string {
  return storage.getItem("context-reader:local-account-owner:v1") || "guest";
}
export function readDictionaryHistoryEvents(storage: Storage = getLearningStorage()): DictionaryHistoryEvent[] {
  try { return JSON.parse(storage.getItem(DICTIONARY_HISTORY_EVENTS_KEY) || "[]").filter((e: DictionaryHistoryEvent) =>
    e && typeof e.id === "string" && ["query", "delete"].includes(e.kind) && typeof e.query === "string"
    && e.normalizedQuery === normalizeStandaloneDictionaryQuery(e.query) && Number.isFinite(Date.parse(e.at))
    && Array.isArray(e.observedDeletes) && e.observedDeletes.every(id => typeof id === "string")); } catch { return []; }
}
export function mergeDictionaryHistoryEvents(storage: Storage, incoming: DictionaryHistoryEvent[]): void {
  const events = new Map(readDictionaryHistoryEvents(storage).map(e => [e.id, e]));
  for (const e of incoming) {
    if (!e || !e.id || !["query", "delete"].includes(e.kind) || typeof e.query !== "string"
      || e.normalizedQuery !== normalizeStandaloneDictionaryQuery(e.query) || !Array.isArray(e.observedDeletes)
      || !e.observedDeletes.every(id => typeof id === "string") || !Number.isFinite(Date.parse(e.at))) continue;
    const old = events.get(e.id);
    if (!old || JSON.stringify(e) > JSON.stringify(old)) events.set(e.id, e);
  }
  storage.setItem(DICTIONARY_HISTORY_EVENTS_KEY, JSON.stringify([...events.values()].sort((a,b)=>a.id.localeCompare(b.id))));
}
export function beginDictionaryQuery(query: string): DictionaryQueryIntent {
  const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
  return { owner: dictionaryHistoryOwner(), event: { id: crypto.randomUUID(), kind: "query", query,
    normalizedQuery, at: new Date().toISOString(), observedDeletes: readDictionaryHistoryEvents()
      .filter(e=>e.kind === "delete" && e.normalizedQuery === normalizedQuery).map(e=>e.id) } };
}
function projectHistory(storage: Storage, legacy: StandaloneDictionaryHistoryItem[]): StandaloneDictionaryHistoryItem[] {
  const events = readDictionaryHistoryEvents(storage);
  const grouped = new Map<string, DictionaryHistoryEvent[]>();
  for (const e of events) grouped.set(e.normalizedQuery, [...(grouped.get(e.normalizedQuery)||[]), e]);
  const result = new Map(legacy.map(e=>[e.normalizedQuery,e]));
  for (const [key, rows] of grouped) {
    const deletes = rows.filter(e=>e.kind === "delete").map(e=>e.id);
    const live = rows.filter(e=>e.kind === "query" && deletes.every(id=>e.observedDeletes.includes(id)))
      .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)).at(-1);
    if (live) result.set(key, {query:live.query, normalizedQuery:key, lastLookedUpAt:live.at});
    else result.delete(key);
  }
  return sortAndDeduplicateStandaloneDictionaryHistory([...result.values()]);
}

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
  storage: Storage | null = typeof window === "undefined" ? null : getLearningStorage(),
): StandaloneDictionaryHistoryItem[] {
  if (!storage) return [];
  try {
    return projectHistory(storage, sortAndDeduplicateStandaloneDictionaryHistory(
      deserializeHistory(storage.getItem(STANDALONE_DICTIONARY_HISTORY_KEY)),
    ));
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

export function recordStandaloneDictionaryHistory(query: string, intent = beginDictionaryQuery(query)): StandaloneDictionaryHistoryItem[] {
  if (typeof window === "undefined" || intent.owner !== dictionaryHistoryOwner()) return [];
  if (intent.event.normalizedQuery !== normalizeStandaloneDictionaryQuery(query)) return readStandaloneDictionaryHistory();
  mergeDictionaryHistoryEvents(getLearningStorage(), [intent.event]);
  const next = readStandaloneDictionaryHistory();
  writeStandaloneDictionaryHistory(getLearningStorage(), next);
  notifyAccountDataChanged(["preferences"]);
  return next;
}

export async function migrateStandaloneDictionarySessionHistory(
  queries: string[], sourceOwner?: string,
): Promise<StandaloneDictionaryHistoryItem[]> {
  if (typeof window === "undefined") return [];
  const storage = getLearningStorage(), owner = dictionaryHistoryOwner(storage);
  // Unowned legacy caches are retained, never guessed to belong to this account.
  if (!sourceOwner || sourceOwner !== owner) return readStandaloneDictionaryHistory(storage);
  const key = `${owner}:session:v3`;
  const migrations = JSON.parse(storage.getItem(DICTIONARY_HISTORY_MIGRATIONS_KEY) || "{}");
  if (migrations[key]) return readStandaloneDictionaryHistory(storage);
  const existing = readStandaloneDictionaryHistory(storage);
  // New durable history is already authoritative. No cache-to-history refill.
  if (storage.getItem(STANDALONE_DICTIONARY_HISTORY_KEY) === null) {
    const tombstones = JSON.parse(storage.getItem("context-reader:sync-tombstones:v1") || "{}");
    const rows = queries.map((query,index)=>({query,normalizedQuery:normalizeStandaloneDictionaryQuery(query),
      lastLookedUpAt:new Date(Date.UTC(2000,0,1)+index*1000).toISOString()}))
      .filter(item=>!tombstones[`preferences:${standaloneDictionaryHistoryObjectKey(item)}`]);
    writeStandaloneDictionaryHistory(storage, projectHistory(storage, [...existing,...rows]));
  }
  await flushLearningStorage();
  if (owner !== dictionaryHistoryOwner(storage)) return [];
  storage.setItem(DICTIONARY_HISTORY_MIGRATIONS_KEY, JSON.stringify({...migrations,[key]:true}));
  try { await flushLearningStorage(); } catch (error) {
    storage.setItem(DICTIONARY_HISTORY_MIGRATIONS_KEY, JSON.stringify(migrations)); throw error;
  }
  notifyAccountDataChanged(["preferences"]);
  return readStandaloneDictionaryHistory(storage);
}

export async function removeStandaloneDictionaryHistory(query: string): Promise<StandaloneDictionaryHistoryItem[]> {
  if (typeof window === "undefined") return [];
  const storage = getLearningStorage(), owner = dictionaryHistoryOwner(storage);
  const normalizedQuery = normalizeStandaloneDictionaryQuery(query);
  if (!normalizedQuery) return readStandaloneDictionaryHistory(storage);
  mergeDictionaryHistoryEvents(storage, [{id:crypto.randomUUID(),kind:"delete",query,normalizedQuery,
    at:new Date().toISOString(),observedDeletes:[]}]);
  const next = readStandaloneDictionaryHistory(storage);
  writeStandaloneDictionaryHistory(storage, next);
  notifyAccountObjectsDeleted("preferences", [standaloneDictionaryHistoryObjectKey({normalizedQuery})]);
  // A failure propagates to the UI. The managed storage retains the pending write for retry.
  await flushLearningStorage();
  return owner === dictionaryHistoryOwner(storage) ? readStandaloneDictionaryHistory(storage) : [];
}

export function standaloneDictionaryHistoryObjectKey(
  item: Pick<StandaloneDictionaryHistoryItem, "normalizedQuery">,
): string {
  return `${STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX}${encodeURIComponent(item.normalizedQuery)}`;
}

export function isStandaloneDictionaryHistoryObjectKey(objectKey: string): boolean {
  return objectKey.startsWith(STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX);
}
