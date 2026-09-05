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
  normalizeArticleReadingState,
  readArticleReadingStates,
  READING_STATES_KEY,
  writeArticleReadingStates,
} from "@/lib/readingState";
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
import { readStoredArticles, writeStoredArticles } from "@/lib/articleStorage";

const KEYS = {
  articles: "context-reader:articles:v1",
  vocabulary: "context-reader:vocabulary:v1",
  explanations: "context-reader:explanations:v5",
  translations: "context-reader:article-translations:v1",
  translationBlocks: "context-reader:article-translation-blocks:v1",
  readingStates: READING_STATES_KEY,
  dictionaryHistory: STANDALONE_DICTIONARY_HISTORY_KEY,
  dictionaryCache: STANDALONE_DICTIONARY_CACHE_KEY,
  recommendationPreferences: RECOMMENDATION_PREFERENCES_STORAGE_KEY,
};
const COMPRESSED_PREFIX = "lz-utf16:";
const VOCABULARY_CONFLICT_RECOVERY_KEY = "context-reader:vocabulary-conflict-recovery:v1";
const ACCOUNT_LOCAL_OWNER_KEY = "context-reader:local-account-owner:v1";
const LAST_SYNC_KEY = "context-reader:last-sync:v1";
const SYNC_STATE_KEY = "context-reader:sync-state:v2";
const ARTICLE_STORAGE_RECOVERY_KEY = "context-reader:article-storage-recovery:20260905";
const ACCOUNT_LOCAL_DATA_KEYS = [
  ...Object.values(KEYS),
  ACCOUNT_SYNC_TOMBSTONES_KEY,
  VOCABULARY_CONFLICT_RECOVERY_KEY,
  LAST_SYNC_KEY,
  SYNC_STATE_KEY,
  ARTICLE_STORAGE_RECOVERY_KEY,
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
  mode?: "full" | "pull-only";
  dirtyKinds?: SyncObjectKind[];
  deferLocalWork?: boolean;
}

async function waitForBrowserProcessingWindow(
  maxWaitMs = 30_000,
  interactionQuietMs = 1_500,
): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const idleWindow = window as typeof window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  };
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let lastInteractionAt = startedAt;
    const markInteraction = () => { lastInteractionAt = performance.now(); };
    const interactionEvents = ["scroll", "pointermove", "keydown", "touchmove", "wheel"] as const;
    for (const eventName of interactionEvents) {
      window.addEventListener(eventName, markInteraction, { passive: true });
    }
    const finish = (result: boolean) => {
      for (const eventName of interactionEvents) window.removeEventListener(eventName, markInteraction);
      resolve(result);
    };
    const tryIdle = () => {
      const inspectWindow = (timeRemaining: number) => {
        const scheduling = navigator as Navigator & {
          scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean };
        };
        const hasPendingInput = scheduling.scheduling?.isInputPending?.({ includeContinuous: true }) ?? false;
        const quietFor = performance.now() - lastInteractionAt;
        if (!hasPendingInput && quietFor >= interactionQuietMs && timeRemaining >= 8) {
          finish(true);
          return;
        }
        if (performance.now() - startedAt >= maxWaitMs) {
          finish(false);
          return;
        }
        window.setTimeout(tryIdle, 120);
      };
      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback((deadline) => inspectWindow(deadline.timeRemaining()), { timeout: 1_000 });
      } else {
        window.setTimeout(() => inspectWindow(16), 32);
      }
    };
    tryIdle();
  });
}

export function accountSyncKindsForStorageKey(key: string | null): SyncObjectKind[] {
  if (!key) return [];
  if (key === KEYS.articles) return ["article"];
  if (key === KEYS.vocabulary) return ["vocabulary"];
  if (key === KEYS.explanations) return ["explanation"];
  if (key === KEYS.translations) return ["article_translation"];
  if (key === KEYS.translationBlocks) return ["translation_block"];
  if (key === KEYS.readingStates) return ["reading_state"];
  if (key === KEYS.dictionaryHistory || key === KEYS.dictionaryCache || key === KEYS.recommendationPreferences) {
    return ["preferences"];
  }
  return [];
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

let cachedSyncStateRaw: string | null | undefined;
let cachedSyncState: StoredSyncState | null = null;

function readSyncState(): StoredSyncState {
  const raw = window.localStorage.getItem(SYNC_STATE_KEY);
  if (raw === cachedSyncStateRaw && cachedSyncState) return cachedSyncState;
  const parsed = parseJson<Partial<StoredSyncState> | null>(raw, null);
  if (
    !parsed
    || parsed.protocol !== 2
    || typeof parsed.initialized !== "boolean"
    || typeof parsed.cursor !== "string"
    || !parsed.manifest
    || typeof parsed.manifest !== "object"
  ) {
    cachedSyncStateRaw = raw;
    cachedSyncState = emptySyncState();
    return cachedSyncState;
  }
  cachedSyncStateRaw = raw;
  cachedSyncState = parsed as StoredSyncState;
  return cachedSyncState;
}

function writeSyncState(state: StoredSyncState): void {
  const raw = JSON.stringify(state);
  cachedSyncStateRaw = raw;
  cachedSyncState = state;
  window.localStorage.setItem(SYNC_STATE_KEY, raw);
}

function mergeManifest(
  current: Record<string, SyncManifestEntry>,
  objects: AccountSyncObject[],
): Record<string, SyncManifestEntry> {
  if (objects.length === 0) return current;
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
  if (objects.length === 0) return;
  const storage = window.localStorage;
  const tombstones = readTombstones(storage);
  const incomingKinds = new Set(objects.map((object) => object.kind));
  const needsArticles = incomingKinds.has("article");
  const needsVocabulary = incomingKinds.has("vocabulary");
  const needsReadingStates = incomingKinds.has("reading_state")
    || objects.some((object) => object.kind === "article" && Boolean(object.deletedAt));
  const needsDictionaryHistory = objects.some((object) => (
    object.kind === "preferences" && isStandaloneDictionaryHistoryObjectKey(object.objectKey)
  ));
  const needsDictionaryCache = objects.some((object) => (
    object.kind === "preferences" && isStandaloneDictionaryCacheObjectKey(object.objectKey)
  ));
  const needsRecommendationPreferences = objects.some((object) => (
    object.kind === "preferences" && object.objectKey === RECOMMENDATION_PREFERENCES_OBJECT_KEY
  ));

  const localArticleMerge = needsArticles
    ? mergeDuplicateSavedArticles(readStoredArticles(storage))
    : null;
  const localArticleById = new Map((localArticleMerge?.articles ?? []).map((item) => [item.id, item]));
  if (localArticleMerge) {
    const articleDeduplicatedAt = new Date().toISOString();
    for (const removedId of localArticleMerge.removedIds) {
      tombstones[`article:${removedId}`] ||= articleDeduplicatedAt;
    }
  }
  const localVocabularyById = new Map((needsVocabulary
    ? deduplicateVocabularyEntries(normalizeVocabularyEntries(readVocabulary(storage))).entries
    : []).map((item) => [item.id, item]));
  const localReadingStates = needsReadingStates ? readArticleReadingStates(storage) : {};
  const localDictionaryHistoryByQuery = new Map((needsDictionaryHistory
    ? readStandaloneDictionaryHistory(storage)
    : []).map((item) => [item.normalizedQuery, item]));
  const localDictionaryCacheByQuery = new Map((needsDictionaryCache
    ? readStandaloneDictionaryCache(storage)
    : []).map((item) => [item.normalizedQuery, item]));
  let localRecommendationPreferences = needsRecommendationPreferences
    ? readRecommendationPreferences(storage)
    : null;
  const activeCloudVocabularyIds = needsVocabulary
    ? new Set(
        Object.entries(manifest)
          .filter(([identity, entry]) => identity.startsWith("vocabulary:") && !entry.deleted)
          .map(([identity]) => identity.slice("vocabulary:".length)),
      )
    : new Set<string>();

  const maps: Partial<Record<SyncObjectKind, Record<string, unknown>>> = {};
  if (incomingKinds.has("explanation")) maps.explanation = parseJson(storage.getItem(KEYS.explanations), {});
  if (incomingKinds.has("article_translation")) maps.article_translation = parseJson(storage.getItem(KEYS.translations), {});
  if (incomingKinds.has("translation_block")) maps.translation_block = parseJson(storage.getItem(KEYS.translationBlocks), {});

  for (const object of objects) {
    const objectIdentity = `${object.kind}:${object.objectKey}`;
    const localDeletedAt = tombstones[objectIdentity];
    if (object.deletedAt) {
      if (object.kind === "article") {
        localArticleById.delete(object.objectKey);
        delete localReadingStates[object.objectKey];
      }
      else if (object.kind === "vocabulary") localVocabularyById.delete(object.objectKey);
      else if (object.kind === "reading_state") delete localReadingStates[object.objectKey];
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
      } else if (maps[object.kind]) delete maps[object.kind]![object.objectKey];
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
    } else if (object.kind === "reading_state") {
      const cloud = normalizeArticleReadingState({
        ...(object.payload && typeof object.payload === "object" ? object.payload : {}),
        articleId: object.objectKey,
      });
      if (!cloud) continue;
      const local = localReadingStates[object.objectKey];
      if (!local || timestamp(object.clientUpdatedAt) >= timestamp(local.updatedAt)) {
        localReadingStates[object.objectKey] = { ...cloud, updatedAt: object.clientUpdatedAt };
      }
    } else if (
      object.kind === "preferences"
      && object.objectKey === RECOMMENDATION_PREFERENCES_OBJECT_KEY
      && localRecommendationPreferences
    ) {
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
    } else if (maps[object.kind]) {
      maps[object.kind]![object.objectKey] = object.payload;
    }
  }

  if (needsArticles) {
    const mergedArticles = mergeDuplicateSavedArticles(Array.from(localArticleById.values()));
    const mergedAt = new Date().toISOString();
    for (const removedId of mergedArticles.removedIds) {
      tombstones[`article:${removedId}`] ||= mergedAt;
    }
    writeStoredArticles(storage, mergedArticles.articles);
  }
  if (needsVocabulary) {
    const deduplicatedVocabulary = deduplicateVocabularyEntries(Array.from(localVocabularyById.values()));
    const deduplicatedAt = new Date().toISOString();
    for (const removedId of deduplicatedVocabulary.removedIds) {
      if (activeCloudVocabularyIds.has(removedId)) {
        tombstones[`vocabulary:${removedId}`] = deduplicatedAt;
      }
    }
    writeVocabulary(storage, deduplicatedVocabulary.entries);
  }
  if (needsReadingStates) writeArticleReadingStates(storage, localReadingStates, { notify: false });
  if (maps.explanation) storage.setItem(KEYS.explanations, JSON.stringify(maps.explanation));
  if (maps.article_translation) storage.setItem(KEYS.translations, JSON.stringify(maps.article_translation));
  if (maps.translation_block) storage.setItem(KEYS.translationBlocks, JSON.stringify(maps.translation_block));
  if (needsDictionaryHistory) writeStandaloneDictionaryHistory(storage, Array.from(localDictionaryHistoryByQuery.values()));
  if (needsDictionaryCache) writeStandaloneDictionaryCache(storage, Array.from(localDictionaryCacheByQuery.values()));
  writeTombstones(storage, tombstones);
}

function collectLocalObjects(
  manifest: Record<string, SyncManifestEntry>,
  dirtyKinds?: SyncObjectKind[],
): AccountSyncObject[] {
  const storage = window.localStorage;
  const now = new Date().toISOString();
  const tombstones = readTombstones(storage);
  const result = new Map<string, AccountSyncObject>();
  const requestedKinds = dirtyKinds?.length ? new Set(dirtyKinds) : null;
  const wants = (kind: SyncObjectKind) => !requestedKinds || requestedKinds.has(kind);
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

  if (wants("article")) {
    const localArticleMerge = mergeDuplicateSavedArticles(
      readStoredArticles(storage),
    );
    if (localArticleMerge.removedIds.length) {
      writeStoredArticles(storage, localArticleMerge.articles);
      for (const removedId of localArticleMerge.removedIds) {
        tombstones[`article:${removedId}`] ||= now;
      }
    }
    for (const item of localArticleMerge.articles) {
      add("article", item.id, item, item.updatedAt || now);
    }
  }
  if (wants("vocabulary")) {
    const localVocabulary = deduplicateVocabularyEntries(
      normalizeVocabularyEntries(readVocabulary(storage)),
    ).entries;
    for (const item of localVocabulary) {
      add("vocabulary", item.id, item, item.updatedAt || item.createdAt || now);
    }
  }
  if (wants("reading_state")) {
    for (const item of Object.values(readArticleReadingStates(storage))) {
      add("reading_state", item.articleId, item, item.updatedAt);
    }
  }
  if (wants("preferences")) {
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
  }

  const cacheSpecs: Array<[SyncObjectKind, string]> = [
    ["explanation", KEYS.explanations],
    ["article_translation", KEYS.translations],
    ["translation_block", KEYS.translationBlocks],
  ];
  for (const [kind, key] of cacheSpecs) {
    if (!wants(kind)) continue;
    const values = parseJson<Record<string, unknown>>(storage.getItem(key), {});
    for (const [objectKey, payload] of Object.entries(values)) add(kind, objectKey, payload);
  }

  for (const [identity, deletedAt] of Object.entries(tombstones)) {
    const separator = identity.indexOf(":");
    const kind = identity.slice(0, separator) as SyncObjectKind;
    const objectKey = identity.slice(separator + 1);
    if (!wants(kind)) continue;
    const deletable = kind === "article"
      || kind === "vocabulary"
      || kind === "reading_state"
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
  mode: "full" | "pull-only",
  dirtyKinds?: SyncObjectKind[],
  deferLocalWork = false,
): Promise<AccountSyncResult> {
  const state = readSyncState();
  // The first compressed-article rollout could leave an already-initialized
  // browser with fewer local articles than its cloud snapshot. An incremental
  // cursor cannot see those older objects again, so each account performs one
  // bounded protocol-2 snapshot replay. Missing local data never becomes a
  // deletion; explicit tombstones remain the only deletion authority.
  const recoveringArticleStorage = window.localStorage.getItem(ARTICLE_STORAGE_RECOVERY_KEY) !== "complete";
  const initial = !state.initialized || recoveringArticleStorage;
  const cloud = recoveringArticleStorage
    ? await readInitialSnapshot(report)
    : await readCloudChanges(state, report);
  if (deferLocalWork && (mode === "full" || cloud.objects.length > 0)) {
    const canProcess = await waitForBrowserProcessingWindow();
    if (!canProcess) throw new Error("账号同步等待浏览器空闲超时，将在下次空闲时重试。");
  }
  let manifest = mergeManifest(state.manifest, cloud.objects);
  report({ phase: "merging", initial, pulledCount: cloud.objects.length, pushedCount: 0 });
  if (cloud.objects.length > 0) {
    mergeCloudIntoLocal(cloud.objects, manifest);
    notifyAccountDataMerged(Array.from(new Set(cloud.objects.map((object) => object.kind))));
  }
  const local = mode === "full"
    ? collectLocalObjects(manifest, initial || cloud.objects.length > 0 ? undefined : dirtyKinds)
    : [];
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
      return performAccountSync(retriesRemaining - 1, report, startedAt, mode, dirtyKinds, deferLocalWork);
    }
    if (!response.ok) throw new Error(data.error || "同步失败，请稍后重试。");
  }

  if (!state.initialized || cloud.cursor !== state.cursor || manifest !== state.manifest) {
    writeSyncState({ protocol: 2, initialized: true, cursor: cloud.cursor, manifest });
  }
  if (recoveringArticleStorage) {
    window.localStorage.setItem(ARTICLE_STORAGE_RECOVERY_KEY, "complete");
  }
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

interface ActiveSync {
  mode: "full" | "pull-only";
  promise: Promise<AccountSyncResult>;
}

let activeSync: ActiveSync | null = null;
const progressListeners = new Set<(progress: AccountSyncProgress) => void>();

function reportProgress(progress: AccountSyncProgress): void {
  for (const listener of progressListeners) listener(progress);
}

export function syncAccountData(options: AccountSyncOptions = {}): Promise<AccountSyncResult> {
  if (options.onProgress) progressListeners.add(options.onProgress);
  const mode = options.mode ?? "full";

  if (activeSync) {
    const current = activeSync;
    const needsFollowUp = mode === "full"
      && (current.mode === "pull-only" || Boolean(options.dirtyKinds?.length));
    const pending = needsFollowUp
      ? current.promise.catch(() => undefined).then(() => syncAccountData({
          ...options,
          onProgress: undefined,
          dirtyKinds: current.mode === "pull-only" ? undefined : options.dirtyKinds,
        }))
      : current.promise;
    return pending.finally(() => {
      if (options.onProgress) progressListeners.delete(options.onProgress);
    });
  }

  const startedAt = Date.now();
  reportProgress({ phase: "waiting", initial: !readSyncState().initialized, pulledCount: 0, pushedCount: 0 });
  const run = () => performAccountSync(
    3,
    reportProgress,
    startedAt,
    mode,
    options.dirtyKinds,
    options.deferLocalWork,
  );
  const lockedSync = typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("context-reader:account-sync", { mode: "exclusive" }, run)
    : run();
  const record: ActiveSync = { mode, promise: Promise.resolve(null as never) };
  record.promise = lockedSync.finally(() => {
    if (activeSync === record) activeSync = null;
  });
  activeSync = record;
  return record.promise.finally(() => {
    if (options.onProgress) progressListeners.delete(options.onProgress);
  });
}
