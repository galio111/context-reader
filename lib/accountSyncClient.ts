"use client";

import LZString from "lz-string";
import { ACCOUNT_SYNC_TOMBSTONES_KEY, notifyAccountDataMerged } from "@/lib/accountEvents";
import { mergeDuplicateSavedArticles } from "@/lib/savedArticleMerge";
import { normalizeVocabularyEntries } from "@/lib/vocabulary";
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
};
const COMPRESSED_PREFIX = "lz-utf16:";
const VOCABULARY_CONFLICT_RECOVERY_KEY = "context-reader:vocabulary-conflict-recovery:v1";

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

function cloudMap(objects: AccountSyncObject[]): Map<string, AccountSyncObject> {
  return new Map(objects.map((item) => [`${item.kind}:${item.objectKey}`, item]));
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

function conflictId(id: string, payload: unknown): string {
  return `${id}-local-recovered-${stableHash(payload)}`;
}

function readTombstones(storage: Storage): Record<string, string> {
  return parseJson<Record<string, string>>(storage.getItem(ACCOUNT_SYNC_TOMBSTONES_KEY), {});
}

function writeTombstones(storage: Storage, tombstones: Record<string, string>): void {
  storage.setItem(ACCOUNT_SYNC_TOMBSTONES_KEY, JSON.stringify(tombstones));
}

function mergeCloudIntoLocal(objects: AccountSyncObject[]): void {
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
  const activeCloudVocabularyIds = new Set(
    objects
      .filter((object) => object.kind === "vocabulary" && !object.deletedAt)
      .map((object) => object.objectKey),
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
      else if (object.kind in maps) delete maps[object.kind][object.objectKey];
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
  writeTombstones(storage, tombstones);
}

function collectLocalObjects(serverObjects: AccountSyncObject[]): AccountSyncObject[] {
  const storage = window.localStorage;
  const versions = cloudMap(serverObjects);
  const now = new Date().toISOString();
  const tombstones = readTombstones(storage);
  const result = new Map<string, AccountSyncObject>();
  const add = (kind: SyncObjectKind, objectKey: string, payload: unknown, updatedAt = now) => {
    const server = versions.get(`${kind}:${objectKey}`);
    if (server && !server.deletedAt && payloadEqual(payload, server.payload)) {
      return;
    }
    result.set(`${kind}:${objectKey}`, {
      kind,
      objectKey,
      payload,
      clientUpdatedAt: updatedAt,
      serverVersion: server?.serverVersion ?? 0,
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
    if ((kind !== "article" && kind !== "vocabulary") || !objectKey) continue;
    const server = versions.get(identity);
    if (server?.deletedAt && timestamp(server.deletedAt) >= timestamp(deletedAt)) {
      delete tombstones[identity];
      continue;
    }
    result.set(identity, {
      kind,
      objectKey,
      payload: server?.payload ?? {},
      clientUpdatedAt: deletedAt,
      serverVersion: server?.serverVersion ?? 0,
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

async function readCloud(): Promise<AccountSyncObject[]> {
  const objects: AccountSyncObject[] = [];
  let offset = 0;
  while (offset <= 20_000) {
    const response = await fetch(`/api/account/sync?offset=${offset}`, { cache: "no-store" });
    const data = await response.json() as {
      objects?: AccountSyncObject[];
      nextOffset?: number | null;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error || "读取云端数据失败。");
    objects.push(...(data.objects ?? []));
    if (data.nextOffset === null || data.nextOffset === undefined) return objects;
    if (!Number.isFinite(data.nextOffset) || data.nextOffset <= offset) {
      throw new Error("云端同步分页无效，请稍后重试。");
    }
    offset = data.nextOffset;
  }
  throw new Error("云端同步对象超过 20000 条，请先导出备份后分批处理。");
}

async function performAccountSync(retriesRemaining: number): Promise<{ objectCount: number; syncedAt: string }> {
  const cloud = await readCloud();
  mergeCloudIntoLocal(cloud);
  notifyAccountDataMerged();
  const local = collectLocalObjects(cloud);
  const response = await fetch("/api/account/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objects: local }),
  });
  const data = await response.json() as { objects?: AccountSyncWriteResult[]; error?: string; conflict?: boolean };
  clearAcceptedTombstones(data.objects ?? []);
  if (response.status === 409 && retriesRemaining > 0) {
    return performAccountSync(retriesRemaining - 1);
  }
  if (!response.ok) throw new Error(data.error || "同步失败，请稍后重试。");
  const syncedAt = new Date().toISOString();
  window.localStorage.setItem("context-reader:last-sync:v1", syncedAt);
  return { objectCount: local.length, syncedAt };
}

let activeSync: Promise<{ objectCount: number; syncedAt: string }> | null = null;

export function syncAccountData(): Promise<{ objectCount: number; syncedAt: string }> {
  if (activeSync) return activeSync;
  const run = () => performAccountSync(3);
  const lockedSync = typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("context-reader:account-sync", { mode: "exclusive" }, run)
    : run();
  const sync = lockedSync.finally(() => {
    if (activeSync === sync) activeSync = null;
  });
  activeSync = sync;
  return sync;
}
