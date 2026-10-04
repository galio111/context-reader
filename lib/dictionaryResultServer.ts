import "server-only";
import { accountFetch, writeSyncObjects } from "./accountStore";
import { normalizeDictionaryQuery, normalizeStandaloneDictionaryCacheItem, standaloneDictionaryCacheObjectKey } from "./dictionaryResultSnapshot";
import type { DictionaryResult } from "../types/dictionary";

async function cacheRow(userId: string, query: string) {
  const key = standaloneDictionaryCacheObjectKey({ normalizedQuery: normalizeDictionaryQuery(query) });
  const rows = await accountFetch<Array<{ payload: unknown; server_version: number; deleted_at: string | null }>>(
    `user_data_objects?user_id=eq.${encodeURIComponent(userId)}&kind=eq.preferences&object_key=eq.${encodeURIComponent(key)}&select=payload,server_version,deleted_at&limit=1`,
  );
  return { key, row: rows[0] };
}

export async function readDictionaryResult(userId: string, query: string): Promise<DictionaryResult | null> {
  const { row } = await cacheRow(userId, query);
  const item = row && !row.deleted_at ? normalizeStandaloneDictionaryCacheItem(row.payload) : null;
  return item?.normalizedQuery === normalizeDictionaryQuery(query) ? item.result : null;
}

export async function persistDictionaryResult(userId: string, result: DictionaryResult): Promise<void> {
  const item = normalizeStandaloneDictionaryCacheItem({
    schemaVersion: 2, query: result.query, result, updatedAt: new Date().toISOString(),
  });
  if (!item) return;
  const { key, row } = await cacheRow(userId, result.query);
  // Existing protocol-2 CAS handles concurrent device writes; never replace a
  // newer result by bypassing the account's merge contract.
  const [written] = await writeSyncObjects(userId, [{
    kind: "preferences", objectKey: key, payload: item,
    clientUpdatedAt: item.updatedAt, serverVersion: Number(row?.server_version || 0),
  }]);
  if (!written?.accepted && !normalizeStandaloneDictionaryCacheItem(written?.payload)) {
    throw new Error("Dictionary snapshot was not durably stored.");
  }
}
