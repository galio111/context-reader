"use client";

import LZString from "lz-string";
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

function cloudMap(objects: AccountSyncObject[]): Map<string, AccountSyncObject> {
  return new Map(objects.map((item) => [`${item.kind}:${item.objectKey}`, item]));
}

function conflictId(id: string): string {
  return `${id}-local-recovered-${Date.now().toString(36)}`;
}

function mergeCloudIntoLocal(objects: AccountSyncObject[]): void {
  const storage = window.localStorage;
  const localArticles = parseJson<SavedArticle[]>(storage.getItem(KEYS.articles), []);
  const localVocabulary = readVocabulary(storage);
  const localArticleById = new Map(localArticles.map((item) => [item.id, item]));
  const localVocabularyById = new Map(localVocabulary.map((item) => [item.id, item]));

  const maps: Record<string, Record<string, unknown>> = {
    explanation: parseJson(storage.getItem(KEYS.explanations), {}),
    article_translation: parseJson(storage.getItem(KEYS.translations), {}),
    translation_block: parseJson(storage.getItem(KEYS.translationBlocks), {}),
  };

  for (const object of objects) {
    if (object.deletedAt) continue;
    if (object.kind === "article") {
      const cloud = object.payload as SavedArticle;
      if (!cloud?.id) continue;
      const local = localArticleById.get(cloud.id);
      if (local && JSON.stringify(local) !== JSON.stringify(cloud)) {
        const recoveredId = conflictId(local.id);
        localArticleById.set(recoveredId, { ...local, id: recoveredId, title: `${local.title}（本地恢复副本）` });
      }
      localArticleById.set(cloud.id, cloud);
    } else if (object.kind === "vocabulary") {
      const cloud = object.payload as VocabularyEntry;
      if (!cloud?.id) continue;
      const local = localVocabularyById.get(cloud.id);
      if (local && JSON.stringify(local) !== JSON.stringify(cloud)) {
        const recoveredId = conflictId(local.id);
        localVocabularyById.set(recoveredId, { ...local, id: recoveredId });
      }
      localVocabularyById.set(cloud.id, cloud);
    } else if (object.kind in maps) {
      maps[object.kind][object.objectKey] = object.payload;
    }
  }

  storage.setItem(KEYS.articles, JSON.stringify(Array.from(localArticleById.values())));
  writeVocabulary(storage, Array.from(localVocabularyById.values()));
  storage.setItem(KEYS.explanations, JSON.stringify(maps.explanation));
  storage.setItem(KEYS.translations, JSON.stringify(maps.article_translation));
  storage.setItem(KEYS.translationBlocks, JSON.stringify(maps.translation_block));
}

function collectLocalObjects(serverObjects: AccountSyncObject[]): AccountSyncObject[] {
  const storage = window.localStorage;
  const versions = cloudMap(serverObjects);
  const now = new Date().toISOString();
  const result: AccountSyncObject[] = [];
  const add = (kind: SyncObjectKind, objectKey: string, payload: unknown, updatedAt = now) => {
    const server = versions.get(`${kind}:${objectKey}`);
    result.push({ kind, objectKey, payload, clientUpdatedAt: updatedAt, serverVersion: server?.serverVersion ?? 0 });
  };

  for (const item of parseJson<SavedArticle[]>(storage.getItem(KEYS.articles), [])) {
    add("article", item.id, item, item.updatedAt || now);
  }
  for (const item of readVocabulary(storage)) {
    add("vocabulary", item.id, item, item.createdAt || now);
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
  return result;
}

async function readCloud(): Promise<AccountSyncObject[]> {
  const response = await fetch("/api/account/sync", { cache: "no-store" });
  const data = await response.json() as { objects?: AccountSyncObject[]; error?: string };
  if (!response.ok) throw new Error(data.error || "读取云端数据失败。");
  return data.objects ?? [];
}

export async function syncAccountData(retry = true): Promise<{ objectCount: number; syncedAt: string }> {
  const cloud = await readCloud();
  mergeCloudIntoLocal(cloud);
  const local = collectLocalObjects(cloud);
  const response = await fetch("/api/account/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objects: local }),
  });
  const data = await response.json() as { objects?: AccountSyncWriteResult[]; error?: string; conflict?: boolean };
  if (response.status === 409 && retry) {
    mergeCloudIntoLocal(data.objects ?? []);
    return syncAccountData(false);
  }
  if (!response.ok) throw new Error(data.error || "同步失败，请稍后重试。");
  const syncedAt = new Date().toISOString();
  window.localStorage.setItem("context-reader:last-sync:v1", syncedAt);
  return { objectCount: local.length, syncedAt };
}
