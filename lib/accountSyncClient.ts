"use client";

import LZString from "lz-string";
import { ACCOUNT_SYNC_TOMBSTONES_KEY, notifyAccountDataMerged } from "@/lib/accountEvents";
import { mergeDuplicateSavedArticles } from "@/lib/savedArticleMerge";
import {
  clearStandaloneDictionaryRuntimeCache,
  isStandaloneDictionaryCacheObjectKey,
  normalizeStandaloneDictionaryCacheItem,
  readStandaloneDictionaryCache,
  standaloneDictionaryCacheObjectKey,
  STANDALONE_DICTIONARY_CACHE_KEY,
  writeStandaloneDictionaryCache,
} from "@/lib/standaloneDictionaryCache";
import {
  isStandaloneDictionaryHistoryObjectKey,
  normalizeStandaloneDictionaryHistoryItem,
  readStandaloneDictionaryHistory,
  standaloneDictionaryHistoryObjectKey,
  STANDALONE_DICTIONARY_HISTORY_KEY,
  STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX,
  writeStandaloneDictionaryHistory,
} from "@/lib/standaloneDictionaryHistory";
import { normalizeVocabularyEntries } from "@/lib/vocabulary";
import {
  readRecommendationPreferences,
  RECOMMENDATION_PREFERENCES_OBJECT_KEY,
  RECOMMENDATION_PREFERENCES_STORAGE_KEY,
  writeRecommendationPreferencesFromSync,
} from "@/lib/recommendationPreferences";
import {
  deduplicateVocabularyEntries,
  mergeVocabularyEntryVersions,
  vocabularyIdentity,
} from "@/lib/vocabularyMerge";
import type { SavedArticle } from "@/types/article";
import type { AccountSyncObject, AccountSyncWriteResult, SyncObjectKind } from "@/types/account";
import type { VocabularyEntry } from "@/types/vocabulary";

const KEYS = {
  articles: "context-reader:articles:v1",
  vocabulary: "context-reader:vocabulary:v1",
  explanations: "context-reader:explanations:v5",
  translations: "context-reader:article-translations:v1",
  translationBlocks: "context-reader:article-translation-blocks:v1",
  dictionaryHistory: STANDALONE_DICTIONARY_HISTORY_KEY,
  dictionaryCache: STANDALONE_DICTIONARY_CACHE_KEY,
  recommendationPreferences: RECOMMENDATION_PREFERENCES_STORAGE_KEY,
};
const COMPRESSED_PREFIX = "lz-utf16:";
const VOCABULARY_CONFLICT_RECOVERY_KEY = "context-reader:vocabulary-conflict-recovery:v1";
const ACCOUNT_LOCAL_OWNER_KEY = "context-reader:local-account-owner:v1";
const LAST_SYNC_KEY = "context-reader:last-sync:v1";
const SYNC_STATE_KEY = "context-reader:sync-state:v2";
const ACCOUNT_LOCAL_DATA_KEYS = [
  ...Object.values(KEYS),
  ACCOUNT_SYNC_TOMBSTONES_KEY,
  VOCABULARY_CONFLICT_RECOVERY_KEY,
  LAST_SYNC_KEY,
  SYNC_STATE_KEY,
];

interface SyncManifestEntry {
  version: number;
  hash: string;
  deleted: boolean;
}

interface StoredSyncState {
  protocol: 2;
  initialized: boolean;
  cursor: string;
  manifest: Record<string, SyncManifestEntry>;
}

export type AccountSyncPhase = "waiting" | "pulling" | "merging" | "pushing" | "complete";

export interface AccountSyncProgress {
  phase: AccountSyncPhase;
  initial: boolean;
  pulledCount: number;
  pushedCount: number;
}

export interface AccountSyncResult {
  initial: boolean;
  pulledCount: number;
  pushedCount: number;
  syncedAt: string;
  durationMs: number;
}

export interface AccountSyncOptions {
  onProgress?: (progress: AccountSyncProgress) => void;
}

export function prepareLocalAccountForUser(userId: string, options?: { preserveExistingData?: boolean }): boolean {
  if (typeof window === "undefined" || !userId) return false;

  const storage = window.localStorage;
  const previousOwner = storage.getItem(ACCOUNT_LOCAL_OWNER_KEY);
  const switchedAccount = Boolean(previousOwner && previousOwner !== userId);
  if (switchedAccount && !options?.preserveExistingData) {
    for (const key of ACCOUNT_LOCAL_DATA_KEYS) storage.removeItem(key);
    clearStandaloneDictionaryRuntimeCache();
    notifyAccountDataMerged();
  }
  storage.setItem(ACCOUNT_LOCAL_OWNER_KEY, userId);
  return switchedAccount;
}

export function clearLocalAccountData(): void {
  if (typeof window === "undefined") return;

  for (const key of ACCOUNT_LOCAL_DATA_KEYS) window.localStorage.removeItem(key);
  clearStandaloneDictionaryRuntimeCache();
  window.localStorage.removeItem(ACCOUNT_LOCAL_OWNER_KEY);
  notifyAccountDataMerged();
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function readVocabulary(storage: Storage): VocabularyEntry[] {
  const raw = storage.getItem(KEYS.vocabulary);
  if (!raw) return [];
  const serialized = raw.startsWith(COMPRESSED_PREFIX)
    ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length))
    : raw;
  return parseJson<VocabularyEntry[]>(serialized, []);
}

function writeVocabulary(storage: Storage, items: VocabularyEntry[]): void {
  storage.setItem(KEYS.vocabulary, `${COMPRESSED_PREFIX}${LZString.compressToUTF16(JSON.stringify(items))}`);
}

function preserveVocabularyConflict(storage: Storage, entry: VocabularyEntry): void {
  const raw = storage.getItem(VOCABULARY_CONFLICT_RECOVERY_KEY);
  const serialized = raw?.startsWith(COMPRESSED_PREFIX)
    ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length))
    : raw;
  const existing = parseJson<VocabularyEntry[]>(serialized, []);
  const recoveredId = conflictId(entry.id, entry);
  if (existing.some((item) => item.id === recoveredId)) return;
  const next = [{ ...entry, id: recoveredId }, ...existing];
  storage.setItem(
    VOCABULARY_CONFLICT_RECOVERY_KEY,
    `${COMPRESSED_PREFIX}${LZString.compressToUTF16(JSON.stringify(next))}`,
  );
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function payloadEqual(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function emptySyncState(): StoredSyncState {
  return { protocol: 2, initialized: false, cursor: "", manifest: {} };
}

function readSyncState(): StoredSyncState {
  const parsed = parseJson<Partial<StoredSyncState> | null>(window.localStorage.getItem(SYNC_STATE_KEY), null);
  if (
    !parsed
    || parsed.protocol !== 2
    || typeof parsed.initialized !== "boolean"
    || typeof parsed.cursor !== "string"
    || !parsed.manifest
    || typeof parsed.manifest !== "object"
  ) {
    return emptySyncState();
  }
  return parsed as StoredSyncState;
}

function writeSyncState(state: StoredSyncState): void {
  window.localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

function mergeManifest(
  current: Record<string, SyncManifestEntry>,
  objects: AccountSyncObject[],
): Record<string, SyncManifestEntry> {
  const next = { ...current };
  for (const object of objects) {
    next[`${object.kind}:${object.objectKey}`] = {
      version: object.serverVersion,
      hash: stableHash(object.payload),
      deleted: Boolean(object.deletedAt),
    };
  }
  return next;
}

function conflictId(id: string, payload: unknown): string {
  return `${id}-local-recovered-${stableHash(payload)}`;
}

function readTombstones(storage: Storage): Record<string, string> {
  return parseJson<Record<string, string>>(storage.getItem(ACCOUNT_SYNC_TOMBSTONES_KEY), {});
}

function writeTombstones(storage: Storage, tombstones: Record<string, string>): void {
  storage.setItem(ACCOUNT_SYNC_TOMBSTONES_KEY, JSON.stringify(tombstones));
}

function mergeCloudIntoLocal(
  objects: AccountSyncObject[],
  manifest: Record<string, SyncManifestEntry>,
): void {
  const storage = window.localStorage;
  const tombstones = readTombstones(storage);
  const localArticleMerge = mergeDuplicateSavedArticles(
    parseJson<SavedArticle[]>(storage.getItem(KEYS.articles), []),
  );
  const localArticles = localArticleMerge.articles;
  const articleDeduplicatedAt = new Date().toISOString();
  for (const removedId of localArticleMerge.removedIds) {
    tombstones[`article:${removedId}`] ||= articleDeduplicatedAt;
  }
  const localVocabulary = deduplicateVocabularyEntries(
    normalizeVocabularyEntries(readVocabulary(storage)),
  ).entries;
  const localArticleById = new Map(localArticles.map((item) => [item.id, item]));
  const localVocabularyById = new Map(localVocabulary.map((item) => [item.id, item]));
  const localDictionaryHistoryByQuery = new Map(
    readStandaloneDictionaryHistory(storage).map((item) => [item.normalizedQuery, item]),
  );
  const localDictionaryCacheByQuery = new Map(
    readStandaloneDictionaryCache(storage).map((item) => [item.normalizedQuery, item]),
  );
  let localRecommendationPreferences = readRecommendationPreferences(storage);
  const activeCloudVocabularyIds = new Set(
    Object.entries(manifest)
      .filter(([identity, entry]) => identity.startsWith("vocabulary:") && !entry.deleted)
      .map(([identity]) => identity.slice("vocabulary:".length)),
  );

  const maps: Record<string, Record<string, unknown>> = {
    explanation: parseJson(storage.getItem(KEYS.explanations), {}),
    article_translation: parseJson(storage.getItem(KEYS.translations), {}),
    translation_block: parseJson(storage.getItem(KEYS.translationBlocks), {}),
  };

  for (const object of objects) {
    const objectIdentity = `${object.kind}:${object.objectKey}`;
    const localDeletedAt = tombstones[objectIdentity];
    if (object.deletedAt) {
      if (object.kind === "article") localArticleById.delete(object.objectKey);
      else if (object.kind === "vocabulary") localVocabularyById.delete(object.objectKey);
      else if (object.kind === "preferences" && isStandaloneDictionaryHistoryObjectKey(object.objectKey)) {
        const historyItem = normalizeStandaloneDictionaryHistoryItem(object.payload);
        let normalizedQuery = historyItem?.normalizedQuery ?? "";
        if (!normalizedQuery) {
          try {
            normalizedQuery = decodeURIComponent(
              object.objectKey.slice(STANDALONE_DICTIONARY_HISTORY_OBJECT_PREFIX.length),
            );
          } catch {
            normalizedQuery = "";
          }
        }
        if (normalizedQuery) localDictionaryHistoryByQuery.delete(normalizedQuery);
      } else if (object.kind in maps) delete maps[object.kind][object.objectKey];
      delete tombstones[objectIdentity];
      continue;
    }
    if (localDeletedAt) {
      if (timestamp(localDeletedAt) >= timestamp(object.clientUpdatedAt)) {
        continue;
      }
      delete tombstones[objectIdentity];
    }

    if (object.kind === "article") {
      const cloud = object.payload as SavedArticle;
      if (!cloud?.id) continue;
      const local = localArticleById.get(cloud.id);
      if (!local) {
        localArticleById.set(cloud.id, cloud);
        continue;
      }
      if (payloadEqual(local, cloud)) continue;

      const localUpdatedAt = timestamp(local.updatedAt);
      const cloudUpdatedAt = timestamp(object.clientUpdatedAt);
      if (localUpdatedAt >= cloudUpdatedAt) continue;
      localArticleById.set(cloud.id, cloud);
    } else if (object.kind === "vocabulary") {
      const cloud = normalizeVocabularyEntries([object.payload])[0];
      if (!cloud?.id) continue;
      const local = localVocabularyById.get(cloud.id);
      if (!local) {
        localVocabularyById.set(cloud.id, cloud);
        continue;
      }
      if (payloadEqual(local, cloud)) continue;

      const localUpdatedAt = timestamp(local.updatedAt || local.createdAt);
      const cloudUpdatedAt = timestamp(object.clientUpdatedAt);
      if (localUpdatedAt > cloudUpdatedAt) continue;
      if (localUpdatedAt < cloudUpdatedAt) {
        localVocabularyById.set(cloud.id, cloud);
        continue;
      }
      if (vocabularyIdentity(local) === vocabularyIdentity(cloud)) {
        localVocabularyById.set(cloud.id, {
          ...mergeVocabularyEntryVersions(local, cloud),
          id: cloud.id,
        });
      } else {
        preserveVocabularyConflict(storage, local);
        localVocabularyById.set(cloud.id, cloud);
      }
    } else if (object.kind === "preferences" && object.objectKey === RECOMMENDATION_PREFERENCES_OBJECT_KEY) {
      const cloud = writeRecommendationPreferencesFromSync(
        storage,
        localRecommendationPreferences.scope === "guest"
          || timestamp(object.clientUpdatedAt) >= timestamp(localRecommendationPreferences.updatedAt)
          ? object.payload
          : localRecommendationPreferences,
      );
      localRecommendationPreferences = cloud;
    } else if (object.kind === "preferences" && isStandaloneDictionaryHistoryObjectKey(object.objectKey)) {
      const cloud = normalizeStandaloneDictionaryHistoryItem(object.payload);
      if (!cloud) continue;
      const local = localDictionaryHistoryByQuery.get(cloud.normalizedQuery);
      if (!local || timestamp(cloud.lastLookedUpAt) > timestamp(local.lastLookedUpAt)) {
        localDictionaryHistoryByQuery.set(cloud.normalizedQuery, cloud);
      }
    } else if (object.kind === "preferences" && isStandaloneDictionaryCacheObjectKey(object.objectKey)) {
      const cloud = normalizeStandaloneDictionaryCacheItem(object.payload);
      if (!cloud) continue;
      const local = localDictionaryCacheByQuery.get(cloud.normalizedQuery);
      if (!local || timestamp(cloud.updatedAt) > timestamp(local.updatedAt)) {
        localDictionaryCacheByQuery.set(cloud.normalizedQuery, cloud);
      }
    } else if (object.kind in maps) {
      maps[object.kind][object.objectKey] = object.payload;
    }
  }

  const mergedArticles = mergeDuplicateSavedArticles(Array.from(localArticleById.values()));
  const mergedAt = new Date().toISOString();
  for (const removedId of mergedArticles.removedIds) {
    tombstones[`article:${removedId}`] ||= mergedAt;
  }
  storage.setItem(KEYS.articles, JSON.stringify(mergedArticles.articles));
  const deduplicatedVocabulary = deduplicateVocabularyEntries(Array.from(localVocabularyById.values()));
  const deduplicatedAt = new Date().toISOString();
  for (const removedId of deduplicatedVocabulary.removedIds) {
    if (activeCloudVocabularyIds.has(removedId)) {
      tombstones[`vocabulary:${removedId}`] = deduplicatedAt;
    }
  }
  writeVocabulary(storage, deduplicatedVocabulary.entries);
  storage.setItem(KEYS.explanations, JSON.stringify(maps.explanation));
  storage.setItem(KEYS.translations, JSON.stringify(maps.article_translation));
  storage.setItem(KEYS.translationBlocks, JSON.stringify(maps.translation_block));
  writeStandaloneDictionaryHistory(storage, Array.from(localDictionaryHistoryByQuery.values()));
  writeStandaloneDictionaryCache(storage, Array.from(localDictionaryCacheByQuery.values()));
  writeTombstones(storage, tombstones);
}

function collectLocalObjects(manifest: Record<string, SyncManifestEntry>): AccountSyncObject[] {
  const storage = window.localStorage;
  const now = new Date().toISOString();
  const tombstones = readTombstones(storage);
  const result = new Map<string, AccountSyncObject>();
  const add = (kind: SyncObjectKind, objectKey: string, payload: unknown, updatedAt = now) => {
    const identity = `${kind}:${objectKey}`;
    const server = manifest[identity];
    const hash = stableHash(payload);
    if (server?.deleted || (server && server.hash === hash)) {
      return;
    }
    result.set(identity, {
      kind,
      objectKey,
      payload,
      clientUpdatedAt: updatedAt,
      serverVersion: server?.version ?? 0,
    });
  };

  const localArticleMerge = mergeDuplicateSavedArticles(
    parseJson<SavedArticle[]>(storage.getItem(KEYS.articles), []),
  );
  if (localArticleMerge.removedIds.length) {
    storage.setItem(KEYS.articles, JSON.stringify(localArticleMerge.articles));
    for (const removedId of localArticleMerge.removedIds) {
      tombstones[`article:${removedId}`] ||= now;
    }
  }
  for (const item of localArticleMerge.articles) {
    add("article", item.id, item, item.updatedAt || now);
  }
  const localVocabulary = deduplicateVocabularyEntries(
    normalizeVocabularyEntries(readVocabulary(storage)),
  ).entries;
  for (const item of localVocabulary) {
    add("vocabulary", item.id, item, item.updatedAt || item.createdAt || now);
  }
  for (const item of readStandaloneDictionaryHistory(storage)) {
    add("preferences", standaloneDictionaryHistoryObjectKey(item), item, item.lastLookedUpAt);
  }
  for (const item of readStandaloneDictionaryCache(storage)) {
    add("preferences", standaloneDictionaryCacheObjectKey(item), item, item.updatedAt);
  }
  const recommendationPreferences = readRecommendationPreferences(storage);
  if (recommendationPreferences.scope === "account") {
    add(
      "preferences",
      RECOMMENDATION_PREFERENCES_OBJECT_KEY,
      recommendationPreferences,
      recommendationPreferences.updatedAt || now,
    );
  }

  const cacheSpecs: Array<[SyncObjectKind, string]> = [
    ["explanation", KEYS.explanations],
    ["article_translation", KEYS.translations],
    ["translation_block", KEYS.translationBlocks],
  ];
  for (const [kind, key] of cacheSpecs) {
    const values = parseJson<Record<string, unknown>>(storage.getItem(key), {});
    for (const [objectKey, payload] of Object.entries(values)) add(kind, objectKey, payload);
  }

  for (const [identity, deletedAt] of Object.entries(tombstones)) {
    const separator = identity.indexOf(":");
    const kind = identity.slice(0, separator) as SyncObjectKind;
    const objectKey = identity.slice(separator + 1);
    const deletable = kind === "article"
      || kind === "vocabulary"
      || (kind === "preferences" && isStandaloneDictionaryHistoryObjectKey(objectKey));
    if (!deletable || !objectKey) continue;
    const server = manifest[identity];
    if (server?.deleted) {
      delete tombstones[identity];
      continue;
    }
    result.set(identity, {
      kind,
      objectKey,
      payload: {},
      clientUpdatedAt: deletedAt,
      serverVersion: server?.version ?? 0,
      deletedAt,
    });
  }
  writeTombstones(storage, tombstones);
  return Array.from(result.values());
}

function clearAcceptedTombstones(objects: AccountSyncWriteResult[]): void {
  const storage = window.localStorage;
  const tombstones = readTombstones(storage);
  let changed = false;
  for (const object of objects) {
    if (object.accepted && object.deletedAt) {
      changed = delete tombstones[`${object.kind}:${object.objectKey}`] || changed;
    }
  }
  if (changed) writeTombstones(storage, tombstones);
}

async function readInitialSnapshot(
  report: (progress: AccountSyncProgress) => void,
): Promise<{ objects: AccountSyncObject[]; cursor: string }> {
  const objects: AccountSyncObject[] = [];
  let snapshotCursor = "";
  for (const bootstrap of ["active", "deleted"] as const) {
    let offset = 0;
    for (let page = 0; page < 200; page += 1) {
      const query = new URLSearchParams({ protocol: "2", bootstrap, offset: String(offset) });
      if (snapshotCursor) query.set("snapshot", snapshotCursor);
      const response = await fetch(`/api/account/sync?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as {
        objects?: AccountSyncObject[];
        nextOffset?: number | null;
        snapshotCursor?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "读取首次同步快照失败。");
      if (!snapshotCursor) snapshotCursor = data.snapshotCursor ?? "";
      const pageObjects = data.objects ?? [];
      objects.push(...pageObjects);
      report({ phase: "pulling", initial: true, pulledCount: objects.length, pushedCount: 0 });
      if (data.nextOffset === null || data.nextOffset === undefined) break;
      if (!Number.isFinite(data.nextOffset) || data.nextOffset <= offset) {
        throw new Error("首次同步分页没有前进，请稍后重试。");
      }
      offset = data.nextOffset;
      if (page === 199) throw new Error("首次同步对象过多，请先导出备份后重试。");
    }
  }
  return { objects, cursor: snapshotCursor };
}

async function readCloudChanges(
  state: StoredSyncState,
  report: (progress: AccountSyncProgress) => void,
): Promise<{ objects: AccountSyncObject[]; cursor: string }> {
  if (!state.initialized) return readInitialSnapshot(report);
  const objects: AccountSyncObject[] = [];
  let cursor = state.cursor;
  for (let page = 0; page < 200; page += 1) {
    const query = new URLSearchParams({ protocol: "2" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/account/sync?${query.toString()}`, { cache: "no-store" });
    const data = await response.json() as {
      objects?: AccountSyncObject[];
      nextCursor?: string;
      hasMore?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error || "读取云端数据失败。");
    const pageObjects = data.objects ?? [];
    objects.push(...pageObjects);
    report({
      phase: "pulling",
      initial: !state.initialized,
      pulledCount: objects.length,
      pushedCount: 0,
    });
    const nextCursor = data.nextCursor ?? cursor;
    if (!data.hasMore) return { objects, cursor: nextCursor };
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("云端增量同步游标没有前进，请稍后重试。");
    }
    cursor = nextCursor;
  }
  throw new Error("云端同步变更过多，请先导出备份后重试。");
}

async function performAccountSync(
  retriesRemaining: number,
  report: (progress: AccountSyncProgress) => void,
  startedAt: number,
): Promise<AccountSyncResult> {
  const state = readSyncState();
  const initial = !state.initialized;
  const cloud = await readCloudChanges(state, report);
  let manifest = mergeManifest(state.manifest, cloud.objects);
  report({ phase: "merging", initial, pulledCount: cloud.objects.length, pushedCount: 0 });
  mergeCloudIntoLocal(cloud.objects, manifest);
  notifyAccountDataMerged();
  const local = collectLocalObjects(manifest);
  let writeResults: AccountSyncWriteResult[] = [];

  if (local.length > 0) {
    report({ phase: "pushing", initial, pulledCount: cloud.objects.length, pushedCount: local.length });
    const response = await fetch("/api/account/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: local }),
    });
    const data = await response.json() as { objects?: AccountSyncWriteResult[]; error?: string; conflict?: boolean };
    writeResults = data.objects ?? [];
    clearAcceptedTombstones(writeResults);
    manifest = mergeManifest(manifest, writeResults);
    if (response.status === 409 && retriesRemaining > 0) {
      writeSyncState({ protocol: 2, initialized: true, cursor: cloud.cursor, manifest });
      return performAccountSync(retriesRemaining - 1, report, startedAt);
    }
    if (!response.ok) throw new Error(data.error || "同步失败，请稍后重试。");
  }

  writeSyncState({ protocol: 2, initialized: true, cursor: cloud.cursor, manifest });
  const syncedAt = new Date().toISOString();
  window.localStorage.setItem(LAST_SYNC_KEY, syncedAt);
  const result: AccountSyncResult = {
    initial,
    pulledCount: cloud.objects.length,
    pushedCount: writeResults.filter((object) => object.accepted).length,
    syncedAt,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  report({
    phase: "complete",
    initial,
    pulledCount: result.pulledCount,
    pushedCount: result.pushedCount,
  });
  return result;
}

let activeSync: Promise<AccountSyncResult> | null = null;
const progressListeners = new Set<(progress: AccountSyncProgress) => void>();

function reportProgress(progress: AccountSyncProgress): void {
  for (const listener of progressListeners) listener(progress);
}

export function syncAccountData(options: AccountSyncOptions = {}): Promise<AccountSyncResult> {
  if (options.onProgress) progressListeners.add(options.onProgress);
  if (!activeSync) {
    const startedAt = Date.now();
    reportProgress({ phase: "waiting", initial: !readSyncState().initialized, pulledCount: 0, pushedCount: 0 });
    const run = () => performAccountSync(3, reportProgress, startedAt);
    const lockedSync = typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("context-reader:account-sync", { mode: "exclusive" }, run)
      : run();
    const sync = lockedSync.finally(() => {
      if (activeSync === sync) activeSync = null;
    });
    activeSync = sync;
  }
  const current = activeSync;
  return current.finally(() => {
    if (options.onProgress) progressListeners.delete(options.onProgress);
  });
}
