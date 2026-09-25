"use client";
import {CET_ACTIVITIES_V4_KEY,CET_FINALIZATIONS_V4_KEY,preserveLegacyCetDraft} from "./cetActivityStorage";

import { getLearningStorage, isLearningStorage, initializeLearningStorage, flushLearningStorage } from "@/lib/learningStorage";

import {readCetTrail,writeCetTrail,CET_TRAIL_KEY,CET_TRAIL_PREFIX} from "./cetTypeTrailStorage";
import type {CetTrailEvent} from "./cetTypeTrail";
import { pruneAcknowledgedExplanations } from "@/lib/learningCachePolicy";
import LZString from "lz-string";
import { explanationFromSync, explanationSyncIdentity } from "@/lib/explanationSyncIdentity";
import { hasForegroundLookup } from "@/lib/explanationStreamStore";
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
  DICTIONARY_HISTORY_EVENTS_KEY, DICTIONARY_HISTORY_MIGRATIONS_KEY, DICTIONARY_HISTORY_EVENT_PREFIX,
  readDictionaryHistoryEvents, mergeDictionaryHistoryEvents, type DictionaryHistoryEvent,
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

import { CET_PROGRESS_KEY, CET_OBJECT_PREFIX, readCetAttempts, writeCetAttempts, normalizeCetAttempt, mergeCetAttempt } from "@/lib/cetProgress";
import { CET_ACTIVITIES_V3_KEY, CET_FINALIZATIONS_V3_KEY, cetActivityPrefix, cetCommitPrefix, isCetActivityObject, isCetCommitObject, CET_ACTIVITIES_KEY, CET_FINALIZATIONS_KEY, readCetActivities, writeCetActivities, normalizeCetActivity, readCetCommitPackages, writeCetCommitPackages, type CetCommitPackage } from "@/lib/cetActivityStorage";
import { mergeCetActivity } from "@/lib/cetActivity";
import { CET_EXPOSURES_KEY, CET_EXPOSURE_OBJECT_PREFIX, readCetExposures, writeCetExposures, normalizeCetExposure } from "@/lib/cetExposure";

const KEYS = {
  cetProgress: CET_PROGRESS_KEY,
  cetActivities: CET_ACTIVITIES_KEY,
  cetActivitiesV3: CET_ACTIVITIES_V3_KEY,
  cetFinalizationsV3: CET_FINALIZATIONS_V3_KEY,
  cetFinalizations: CET_FINALIZATIONS_KEY,
  cetExposures: CET_EXPOSURES_KEY,
  articles: "context-reader:articles:v1",
  vocabulary: "context-reader:vocabulary:v1",
  explanations: "context-reader:explanations:v5",
  translations: "context-reader:article-translations:v1",
  translationBlocks: "context-reader:article-translation-blocks:v1",
  readingStates: READING_STATES_KEY,
  cetActivitiesV4: CET_ACTIVITIES_V4_KEY, cetFinalizationsV4:CET_FINALIZATIONS_V4_KEY,
  cetTrail: CET_TRAIL_KEY,
  dictionaryHistoryEvents: DICTIONARY_HISTORY_EVENTS_KEY,
  dictionaryHistoryMigrations: DICTIONARY_HISTORY_MIGRATIONS_KEY,
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
const INDEXEDDB_RECOVERY_KEY = "context-reader:indexeddb-sync-recovery:v1";
const SYNC_STORAGE_RECOVERY_KEY = "context-reader:sync-storage-recovery:20260913";
const ACCOUNT_LOCAL_DATA_KEYS = [
  ...Object.values(KEYS),
  ACCOUNT_SYNC_TOMBSTONES_KEY,
  VOCABULARY_CONFLICT_RECOVERY_KEY,
  "context-reader:vocabulary-backup-before-dedupe:v1",
  "context-reader:cache-access:v1",
  LAST_SYNC_KEY,
  SYNC_STATE_KEY,
  ARTICLE_STORAGE_RECOVERY_KEY,
  SYNC_STORAGE_RECOVERY_KEY,
  INDEXEDDB_RECOVERY_KEY,
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
  verified?: boolean;
  articleCount?: number;
  vocabularyCount?: number;
  initial: boolean;
  pulledCount: number;
  pushedCount: number;
  syncedAt: string;
  durationMs: number;
}

export interface AccountSyncOptions {
  /** Replay the complete cloud snapshot and verify learning data, even with a current cursor. */
  reconcile?: boolean;
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
        if (!hasForegroundLookup() && !hasPendingInput && quietFor >= interactionQuietMs && timeRemaining >= 8) {
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
  if (key === KEYS.cetProgress || key === KEYS.cetActivities || key === KEYS.cetActivitiesV3 || key === KEYS.cetFinalizationsV3 || key === KEYS.cetExposures || key === KEYS.cetFinalizations || key === KEYS.cetActivitiesV4 || key === KEYS.cetFinalizationsV4 || key === KEYS.cetTrail || key === KEYS.dictionaryHistoryEvents || key === KEYS.dictionaryHistoryMigrations || key === KEYS.dictionaryHistory || key === KEYS.dictionaryCache || key === KEYS.recommendationPreferences) {
    return ["preferences"];
  }
  return [];
}

export async function prepareLocalAccountForUser(userId: string, options?: { preserveExistingData?: boolean }): Promise<boolean> {
  await initializeLearningStorage();
  if (typeof window === "undefined" || !userId) return false;

  const storage = getLearningStorage();
  const previousOwner = storage.getItem(ACCOUNT_LOCAL_OWNER_KEY);
  const switchedAccount = Boolean(previousOwner && previousOwner !== userId);
  if (switchedAccount && !options?.preserveExistingData) {
    if (isLearningStorage(storage)) await storage.archiveOwner(previousOwner!);
    for (const key of ACCOUNT_LOCAL_DATA_KEYS) storage.removeItem(key);
    if (isLearningStorage(storage)) { await storage.flush(); await storage.restoreOwner(userId); await storage.clearStage(); }
    clearStandaloneDictionaryRuntimeCache();
    notifyAccountDataMerged();
  }
  // A first login adopts only this browser's guest CET records. Existing
  // account records retain their owner and remain isolated on account switch.
  if (!previousOwner) claimGuestCetRecords(storage, userId);
  storage.setItem(ACCOUNT_LOCAL_OWNER_KEY, userId);
  return switchedAccount;
}

export function claimGuestCetRecords(storage: Storage, userId: string): void {
  if (!userId) return;
  const trail = readCetTrail(storage);
  if (trail.some(e=>e.owner === "guest")) storage.setItem(CET_TRAIL_KEY,JSON.stringify(trail.map(e=>e.owner === "guest"?{...e,owner:userId}:e)));
  const activities = readCetActivities(storage);
  if (activities.some((item) => item.owner === "guest")) {
    writeCetActivities(storage, activities.map((item) => item.owner === "guest" ? { ...item, owner: userId } : item));
  }
  const exposures = readCetExposures(storage);
  if (exposures.some((item) => item.owner === "guest")) {
    writeCetExposures(storage, exposures.map((item) => item.owner === "guest" ? { ...item, owner: userId } : item));
  }
}

export async function clearLocalAccountData(): Promise<void> {
  await initializeLearningStorage();
  if (typeof window === "undefined") return;

  const storage = getLearningStorage();
  const owner = storage.getItem(ACCOUNT_LOCAL_OWNER_KEY);
  if (owner && isLearningStorage(storage)) await storage.archiveOwner(owner);
  for (const key of ACCOUNT_LOCAL_DATA_KEYS) storage.removeItem(key);
  clearStandaloneDictionaryRuntimeCache();
  getLearningStorage().removeItem(ACCOUNT_LOCAL_OWNER_KEY);
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
  storage.setItem(KEYS.vocabulary, isLearningStorage(storage) ? JSON.stringify(items) : `${COMPRESSED_PREFIX}${LZString.compressToUTF16(JSON.stringify(items))}`);
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
  const raw = getLearningStorage().getItem(SYNC_STATE_KEY);
  if (raw === cachedSyncStateRaw && cachedSyncState) return cachedSyncState;
  const serialized = raw?.startsWith(COMPRESSED_PREFIX)
    ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length))
    : raw;
  const parsed = parseJson<Partial<StoredSyncState> | null>(serialized, null);
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
  const serialized = JSON.stringify(state);
  const raw = isLearningStorage(getLearningStorage()) ? serialized : `${COMPRESSED_PREFIX}${LZString.compressToUTF16(serialized)}`;
  // A failed persistent write must never advance the in-memory checkpoint.
  getLearningStorage().setItem(SYNC_STATE_KEY, raw);
  cachedSyncStateRaw = raw;
  cachedSyncState = state;
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
  const storage = getLearningStorage();
  const tombstones = readTombstones(storage);
  // Merge intent events before projecting any legacy active/deleted history rows.
  mergeDictionaryHistoryEvents(storage, objects.filter(o=>o.kind === "preferences" && !o.deletedAt
    && o.objectKey === DICTIONARY_HISTORY_EVENT_PREFIX + (o.payload as DictionaryHistoryEvent)?.id)
    .map(o=>o.payload as DictionaryHistoryEvent));
  writeCetTrail(storage, objects.filter(o=>o.kind === "preferences" && !o.deletedAt && o.objectKey === CET_TRAIL_PREFIX + (o.payload as CetTrailEvent)?.id).map(o=>o.payload as CetTrailEvent));
  const incomingKinds = new Set(objects.map((object) => object.kind));
  const needsCet = objects.some(o => o.kind === "preferences" && o.objectKey.startsWith(CET_OBJECT_PREFIX));
  const cetAttempts = new Map((needsCet ? readCetAttempts(storage) : []).map(item => [item.id, item]));
  const needsCetV2 = objects.some(o => o.kind === "preferences" && (isCetActivityObject(o.objectKey) || isCetCommitObject(o.objectKey)));
  const cetActivities = new Map((needsCetV2 ? readCetActivities(storage) : []).map(item => [item.id, item]));
  const cetCommits = new Map((needsCetV2 ? readCetCommitPackages(storage) : []).map(item => [`${item.attemptId}:${item.finalization.id}`, item]));
  const needsCetExposure = objects.some(o => o.kind === "preferences" && o.objectKey.startsWith(CET_EXPOSURE_OBJECT_PREFIX));
  const cetExposures = new Map((needsCetExposure ? readCetExposures(storage) : []).map(item => [item.id, item]));
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
      else if (object.kind === "preferences" && object.objectKey.startsWith(CET_OBJECT_PREFIX)) cetAttempts.delete(object.objectKey.slice(CET_OBJECT_PREFIX.length));
      // New CET results are append-only. A stale client cannot tombstone them.
      else if (object.kind === "preferences" && (isCetActivityObject(object.objectKey) || isCetCommitObject(object.objectKey) || object.objectKey.startsWith(CET_EXPOSURE_OBJECT_PREFIX))) continue;
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
        if (normalizedQuery && !readDictionaryHistoryEvents(storage).some(e=>e.normalizedQuery === normalizedQuery))
          localDictionaryHistoryByQuery.delete(normalizedQuery);
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
    } else if (object.kind === "preferences" && object.objectKey.startsWith(CET_OBJECT_PREFIX)) {
      const cloud = normalizeCetAttempt(object.payload);
      if(cloud && object.objectKey === CET_OBJECT_PREFIX + cloud.id) cetAttempts.set(cloud.id, mergeCetAttempt(cetAttempts.get(cloud.id), cloud));
    } else if (object.kind === "preferences" && isCetActivityObject(object.objectKey)) {
      const cloud = normalizeCetActivity(object.payload);
      if (cloud && object.objectKey === cetActivityPrefix(cloud) + cloud.id) {
        try { const local=cetActivities.get(cloud.id);cetActivities.set(cloud.id,
          local?.schemaVersion===4&&cloud.schemaVersion!==4?preserveLegacyCetDraft(local,cloud):
          cloud.schemaVersion===4&&local&&local.schemaVersion!==4?preserveLegacyCetDraft(cloud,local):mergeCetActivity(local,cloud)); }
        catch { /* Preserve the existing local identity instead of overwriting it. */ }
      }
    } else if (object.kind === "preferences" && isCetCommitObject(object.objectKey)) {
      const cloud = object.payload as CetCommitPackage;
      if (cloud?.attemptId && cloud.finalization?.id && Array.isArray(cloud.finalization.questions)
        && object.objectKey === `${cetCommitPrefix(cloud)}${cloud.attemptId}:${cloud.finalization.id}`) {
        const identity = `${cloud.attemptId}:${cloud.finalization.id}`;
        const old = cetCommits.get(identity);
        cetCommits.set(identity, old && JSON.stringify(old) > JSON.stringify(cloud) ? old : cloud);
      }
    } else if (object.kind === "preferences" && object.objectKey.startsWith(CET_EXPOSURE_OBJECT_PREFIX)) {
      const cloud = normalizeCetExposure(object.payload);
      if (cloud && object.objectKey === CET_EXPOSURE_OBJECT_PREFIX + cloud.id) {
        const old = cetExposures.get(cloud.id);
        cetExposures.set(cloud.id, old && JSON.stringify(old) > JSON.stringify(cloud) ? old : cloud);
      }
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
    } else if (object.kind === "explanation" && maps.explanation) {
      const entry = explanationFromSync(object.objectKey, object.payload);
      maps.explanation[entry.cacheKey] = entry.explanation;
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
  if (needsCet) writeCetAttempts(storage, Array.from(cetAttempts.values()));
  if (needsCetV2) {
    for (const commit of cetCommits.values()) {
      const activity = cetActivities.get(commit.attemptId);
      if (!activity || activity.finalizations[commit.finalization.id]) continue;
      const incoming = {
        ...activity,
        finalizations: { ...activity.finalizations, [commit.finalization.id]: commit.finalization },
        status: commit.finalization.reason === "ended_for_study" ? "ended" as const : "submitted" as const,
      };
      cetActivities.set(activity.id, mergeCetActivity(activity, incoming));
    }
    writeCetCommitPackages(storage, Array.from(cetCommits.values()));
    writeCetActivities(storage, Array.from(cetActivities.values()));
  }
  if (needsCetExposure) writeCetExposures(storage, Array.from(cetExposures.values()));
  if (needsReadingStates) writeArticleReadingStates(storage, localReadingStates, { notify: false });
  if (maps.explanation) storage.setItem(KEYS.explanations, JSON.stringify(maps.explanation));
  if (maps.article_translation) storage.setItem(KEYS.translations, JSON.stringify(maps.article_translation));
  if (maps.translation_block) storage.setItem(KEYS.translationBlocks, JSON.stringify(maps.translation_block));
  if (needsDictionaryHistory) writeStandaloneDictionaryHistory(storage, Array.from(localDictionaryHistoryByQuery.values()));
  if (needsDictionaryCache) writeStandaloneDictionaryCache(storage, Array.from(localDictionaryCacheByQuery.values()));
  writeTombstones(storage, tombstones);
}

async function collectLocalObjects(
  manifest: Record<string, SyncManifestEntry>,
  dirtyKinds?: SyncObjectKind[],
): Promise<AccountSyncObject[]> {
  const storage = getLearningStorage();
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
    if (!payloadEqual(readStoredArticles(storage), localArticleMerge.articles)) {
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
    if (!payloadEqual(readVocabulary(storage), localVocabulary)) writeVocabulary(storage, localVocabulary);
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
    for (const item of readCetAttempts(storage)) add("preferences", CET_OBJECT_PREFIX + item.id, item, item.updatedAt);
    for (const item of readCetActivities(storage)) add("preferences", cetActivityPrefix(item) + item.id, item, item.updatedAt);
    for (const item of readCetCommitPackages(storage)) add("preferences", `${cetCommitPrefix(item)}${item.attemptId}:${item.finalization.id}`, item, item.finalization.at);
    for (const item of readCetExposures(storage)) add("preferences", CET_EXPOSURE_OBJECT_PREFIX + item.id, item, item.occurredAt);
    for (const event of readCetTrail(storage)) add("preferences", CET_TRAIL_PREFIX + event.id, event, event.at);
    for (const event of readDictionaryHistoryEvents(storage)) add("preferences", DICTIONARY_HISTORY_EVENT_PREFIX + event.id, event, event.at);
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
    for (const [objectKey, payload] of Object.entries(values)) {
      const entry = kind === "explanation"
        ? await explanationSyncIdentity(objectKey, payload)
        : { objectKey, payload };
      add(kind, entry.objectKey, entry.payload);
    }
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
  const storage = getLearningStorage();
  const tombstones = readTombstones(storage);
  let changed = false;
  for (const object of objects) {
    if (object.accepted && object.deletedAt) {
      changed = delete tombstones[`${object.kind}:${object.objectKey}`] || changed;
    }
  }
  if (changed) writeTombstones(storage, tombstones);
}

export class AccountSyncSessionError extends Error {
  constructor() { super("登录状态已失效，请重新登录后同步。"); this.name = "AccountSyncSessionError"; }
}

export async function syncFetch(input: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  const owner = getLearningStorage().getItem(ACCOUNT_LOCAL_OWNER_KEY);
  const headers = new Headers(init.headers);
  if (owner) headers.set("X-Context-Account", owner);
  try {
    const response = await fetch(input, { ...init, headers, signal: controller.signal });
    if (getLearningStorage().getItem(ACCOUNT_LOCAL_OWNER_KEY) !== owner) throw new Error("账号已切换，已停止上一账号的数据恢复。");
    if (response.status === 401) throw new AccountSyncSessionError();
    if (response.status === 429 && retries > 0) {
      const retryHeader = response.headers.get("Retry-After");
      const seconds = retryHeader && Number.isFinite(Number(retryHeader)) ? Number(retryHeader) : 5;
      if (seconds >= 0 && seconds <= 60) {
        window.clearTimeout(timeout);
        await response.body?.cancel();
        reportProgress({ phase: "waiting", initial: false, pulledCount: 0, pushedCount: 0 });
        await new Promise(resolve => window.setTimeout(resolve, Math.max(250, seconds * 1000)));
        if (getLearningStorage().getItem(ACCOUNT_LOCAL_OWNER_KEY) !== owner) throw new Error("账号已切换，已停止上一账号的数据恢复。");
        return syncFetch(input, init, retries - 1);
      }
    }
    return response;
  }
  catch (error) {
    if (controller.signal.aborted) throw new Error("同步请求超时，已保存进度，可重试继续。");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

async function readInitialSnapshot(
  report: (progress: AccountSyncProgress) => void,
): Promise<{ objects: AccountSyncObject[]; cursor: string }> {
  const storage = getLearningStorage();
  const database = isLearningStorage(storage) ? storage : null;
  const owner = storage.getItem(ACCOUNT_LOCAL_OWNER_KEY) || "guest";
  type Resume = { owner: string; startedAt: number; cursor: string; phase: number; offset: number; pages: number };
  let resume = await database?.stageGet<Resume>("resume");
  if (!resume || resume.owner !== owner || Date.now() - resume.startedAt > 30 * 60_000) {
    await database?.clearStage();
    resume = { owner, startedAt: Date.now(), cursor: "", phase: 0, offset: 0, pages: 0 };
  }
  const objects: AccountSyncObject[] = [];
  for (let page = 0; page < resume.pages; page++) {
    const saved = await database?.stageGet<AccountSyncObject[]>(`page:${page}`);
    if (!saved) { await database?.clearStage(); return readInitialSnapshot(report); }
    objects.push(...saved);
  }
  const phases = database
    ? [{ bootstrap: "active", group: "learning" }, { bootstrap: "deleted", group: "learning" }, { bootstrap: "active", group: "cache" }, { bootstrap: "deleted", group: "cache" }]
    : [{ bootstrap: "active", group: "" }, { bootstrap: "deleted", group: "" }];
  for (; resume.phase < phases.length;) {
    const phase = phases[resume.phase];
    const query = new URLSearchParams({ protocol: "2", bootstrap: phase.bootstrap, offset: String(resume.offset) });
    if (phase.group) query.set("group", phase.group);
    if (resume.cursor) query.set("snapshot", resume.cursor);
    const response = await syncFetch(`/api/account/sync?${query.toString()}`, { cache: "no-store" });
    const data = await response.json() as { objects?: AccountSyncObject[]; nextOffset?: number | null; snapshotCursor?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "读取首次同步快照失败。");
    if (!Array.isArray(data.objects)) throw new Error("同步服务未返回完整数据，请稍后重试。");
    if (!resume.cursor) resume.cursor = data.snapshotCursor ?? "";
    objects.push(...data.objects);
    await database?.stagePut(`page:${resume.pages}`, data.objects);
    resume.pages++;
    if (data.nextOffset === null || data.nextOffset === undefined) { resume.phase++; resume.offset = 0; }
    else {
      if (!Number.isFinite(data.nextOffset) || data.nextOffset <= resume.offset) throw new Error("首次同步分页没有前进，请稍后重试。");
      resume.offset = data.nextOffset;
    }
    await database?.stagePut("resume", resume);
    report({ phase: "pulling", initial: true, pulledCount: objects.length, pushedCount: 0 });
    // Make learning content available before downloading historical explanation caches.
    if (database && resume.phase === 2 && resume.offset === 0) {
      mergeCloudIntoLocal(objects, mergeManifest(readSyncState().manifest, objects));
      await flushLearningStorage();
      notifyAccountDataMerged(["article", "vocabulary", "reading_state"]);
    }
    if (resume.pages >= 800) throw new Error("首次同步对象过多，请保留数据并联系站点处理。");
  }
  return { objects, cursor: resume.cursor };
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
    const response = await syncFetch(`/api/account/sync?${query.toString()}`, { cache: "no-store" });
    const data = await response.json() as {
      objects?: AccountSyncObject[];
      nextCursor?: string;
      hasMore?: boolean;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error || "读取云端数据失败。");
    if (!Array.isArray(data.objects)) throw new Error("同步服务未返回完整数据，请稍后重试。");
    const pageObjects = data.objects;
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
  reconcile = false,
): Promise<AccountSyncResult> {
  const state = readSyncState();
  // Reclaim bookkeeping space before any snapshot merge writes larger user data.
  if (!isLearningStorage(getLearningStorage()) && !getLearningStorage().getItem(SYNC_STATE_KEY)?.startsWith(COMPRESSED_PREFIX)) writeSyncState(state);
  // The first compressed-article rollout could leave an already-initialized
  // browser with fewer local articles than its cloud snapshot. An incremental
  // cursor cannot see those older objects again, so each account performs one
  // bounded protocol-2 snapshot replay. Missing local data never becomes a
  // deletion; explicit tombstones remain the only deletion authority.
  const recoveringArticleStorage = getLearningStorage().getItem(ARTICLE_STORAGE_RECOVERY_KEY) !== "complete";
  const recoveringSyncStorage = getLearningStorage().getItem(SYNC_STORAGE_RECOVERY_KEY) !== "complete";
  const recoveringIndexedDB = isLearningStorage(getLearningStorage()) && getLearningStorage().getItem(INDEXEDDB_RECOVERY_KEY) !== "complete";
  const initial = !state.initialized || recoveringArticleStorage || recoveringSyncStorage || recoveringIndexedDB || reconcile;
  const cloud = initial
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
    ? await collectLocalObjects(manifest, initial || cloud.objects.length > 0 ? undefined : dirtyKinds)
    : [];
  const writeResults: AccountSyncWriteResult[] = [];

  if (local.length > 0) {
    const database = getLearningStorage();
    if (isLearningStorage(database)) await database.clearStage();
    const batches: AccountSyncObject[][] = [];
    let batch: AccountSyncObject[] = [], bytes = 0;
    for (const object of local) {
      const size = new TextEncoder().encode(JSON.stringify(object)).byteLength;
      if (size > 7_000_000) throw new Error("单条同步数据过大，原数据已保留，请联系站点处理。");
      if (batch.length && (batch.length >= 200 || bytes + size > 1_500_000)) { batches.push(batch); batch = []; bytes = 0; }
      batch.push(object); bytes += size;
    }
    if (batch.length) batches.push(batch);
    for (const batch of batches) {
      report({ phase: "pushing", initial, pulledCount: cloud.objects.length, pushedCount: writeResults.length });
    const response = await syncFetch("/api/account/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: batch }),
    });
    const data = await response.json() as { objects?: AccountSyncWriteResult[]; error?: string; conflict?: boolean };
    const submitted = new Set(batch.map(object => `${object.kind}:${object.objectKey}`));
    if (!Array.isArray(data.objects) || data.objects.length !== batch.length
      || new Set(data.objects.map(object => `${object.kind}:${object.objectKey}`)).size !== submitted.size
      || data.objects.some(object => !submitted.has(`${object.kind}:${object.objectKey}`) || (response.ok && !object.accepted))) {
      throw new Error("同步服务未确认全部上传数据，本机数据已保留，请稍后重试。");
    }
    writeResults.push(...data.objects);
    clearAcceptedTombstones(data.objects);
    manifest = mergeManifest(manifest, data.objects);
    if (response.status === 409 && retriesRemaining > 0) {
      writeSyncState({ protocol: 2, initialized: state.initialized, cursor: state.cursor, manifest });
      await flushLearningStorage();
      return performAccountSync(retriesRemaining - 1, report, startedAt, mode, dirtyKinds, deferLocalWork, reconcile);
    }
    if (!response.ok) throw new Error(data.error || "同步失败，请稍后重试。");
    writeSyncState({ protocol: 2, initialized: state.initialized, cursor: state.cursor, manifest });
    await flushLearningStorage();
    }
  }

  let verified = false;
  const articles = mode === "full" ? readStoredArticles(getLearningStorage()) : [];
  const vocabulary = mode === "full" ? readVocabulary(getLearningStorage()) : [];
  if (initial && mode === "full") {
    const expected = new Map<string, AccountSyncObject>();
    for (const object of [...cloud.objects, ...writeResults]) {
      if (object.kind !== "article" && object.kind !== "vocabulary") continue;
      const identity = `${object.kind}:${object.objectKey}`;
      if (object.deletedAt) expected.delete(identity);
      else expected.set(identity, object);
    }
    const actual = new Map<string, string>([
      ...articles.map((item) => [`article:${item.id}`, stableSerialize(item)] as const),
      ...vocabulary.map((item) => [`vocabulary:${item.id}`, stableSerialize(item)] as const),
    ]);
    verified = expected.size === actual.size && [...expected].every(([key, object]) => actual.get(key) === stableSerialize(object.payload));
    if (!verified) throw new Error("文章或生词尚未与云端一致，本机数据已保留，请再次校准同步。");
  }
  if (!state.initialized || cloud.cursor !== state.cursor || manifest !== state.manifest) {
    writeSyncState({ protocol: 2, initialized: true, cursor: cloud.cursor, manifest });
  }
  await flushLearningStorage();
  if (recoveringArticleStorage) {
    getLearningStorage().setItem(ARTICLE_STORAGE_RECOVERY_KEY, "complete");
  }
  if (recoveringSyncStorage && mode === "full" && verified) getLearningStorage().setItem(SYNC_STORAGE_RECOVERY_KEY, "complete");
  if (recoveringIndexedDB && mode === "full" && verified) getLearningStorage().setItem(INDEXEDDB_RECOVERY_KEY, "complete");
  if (mode === "full") await pruneAcknowledgedExplanations(getLearningStorage(), async (key, value) => {
    const identity = await explanationSyncIdentity(key, value as Parameters<typeof explanationSyncIdentity>[1]);
    const entry = manifest[`explanation:${identity.objectKey}`];
    return Boolean(entry && !entry.deleted && entry.hash === stableHash(identity.payload));
  });
  const syncedAt = new Date().toISOString();
  getLearningStorage().setItem(LAST_SYNC_KEY, syncedAt);
  const result: AccountSyncResult = {
    verified,
    articleCount: mode === "full" ? articles.length : undefined,
    vocabularyCount: mode === "full" ? vocabulary.length : undefined,
    initial,
    pulledCount: cloud.objects.length,
    pushedCount: writeResults.filter((object) => object.accepted).length,
    syncedAt,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  await flushLearningStorage();
  const database = getLearningStorage();
  if (isLearningStorage(database)) await database.clearStage();
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

export async function syncAccountData(options: AccountSyncOptions = {}): Promise<AccountSyncResult> {
  await initializeLearningStorage();
  await flushLearningStorage();
  if (options.onProgress) progressListeners.add(options.onProgress);
  const mode = options.mode ?? "full";

  if (activeSync) {
    const current = activeSync;
    const needsFollowUp = mode === "full"
      && (current.mode === "pull-only" || Boolean(options.dirtyKinds?.length) || Boolean(options.reconcile));
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
    options.reconcile,
  );
  const lockedSync = typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("context-reader:account-sync", { mode: "exclusive" }, run)
    : run();
  const record: ActiveSync = { mode, promise: Promise.resolve(null as never) };
  record.promise = lockedSync.catch((error: unknown) => {
    if (error instanceof Error && (error.name === "QuotaExceededError" || /exceeded the quota|quota.*exceeded/i.test(error.message))) {
      throw new Error("浏览器存储空间不足，账号已登录，但同步尚未完成。已有数据已保留，请勿清除浏览器数据，联系站点处理。");
    }
    throw error;
  }).finally(() => {
    if (activeSync === record) activeSync = null;
  });
  activeSync = record;
  return record.promise.finally(() => {
    if (options.onProgress) progressListeners.delete(options.onProgress);
  });
}
