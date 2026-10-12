import "server-only";
import { accountFetch, writeSyncObjects } from "./accountStore";
import { normalizeDictionaryQuery, normalizeStandaloneDictionaryCacheItem, standaloneDictionaryCacheObjectKey } from "./dictionaryResultSnapshot";
import { reconcileStandaloneVocabulary } from "./vocabularyLookupSync";
import type { DictionaryResult } from "../types/dictionary";
import type { VocabularyEntry } from "../types/vocabulary";
import type { StandaloneDictionaryCacheItem } from "./dictionaryResultSnapshot";

async function cacheRow(userId: string, query: string) {
  const key = standaloneDictionaryCacheObjectKey({ normalizedQuery: normalizeDictionaryQuery(query) });
  const rows = await accountFetch<Array<{ payload: unknown; server_version: number; deleted_at: string | null }>>(
    `user_data_objects?user_id=eq.${encodeURIComponent(userId)}&kind=eq.preferences&object_key=eq.${encodeURIComponent(key)}&select=payload,server_version,deleted_at&limit=1`,
  );
  return { key, row: rows[0] };
}

export async function readDictionarySnapshot(userId: string, query: string): Promise<StandaloneDictionaryCacheItem | null> {
  const { row } = await cacheRow(userId, query);
  const item = row && !row.deleted_at ? normalizeStandaloneDictionaryCacheItem(row.payload) : null;
  return item?.normalizedQuery === normalizeDictionaryQuery(query) ? item : null;
}

export async function readDictionaryResult(userId: string, query: string): Promise<DictionaryResult | null> {
  return (await readDictionarySnapshot(userId, query))?.result ?? null;
}

type VocabularyRow = { object_key: string; payload: VocabularyEntry; server_version: number; deleted_at: string | null };

async function updateSavedVocabulary(userId: string, snapshot: StandaloneDictionaryCacheItem): Promise<void> {
  // Query only candidate rows belonging to this account. A second pure identity
  // check rejects homonyms, contextual entries and malformed imported objects.
  const pattern = JSON.stringify(snapshot.query.replace(/[\\%_*]/g, "\\$&"));
  const params = new URLSearchParams({
    user_id: "eq." + userId, kind: "eq.vocabulary", deleted_at: "is.null",
    select: "object_key,payload,server_version,deleted_at", order: "object_key.asc",
    or: `(payload->>word.ilike.${pattern},payload->dictionaryResult->>query.ilike.${pattern},payload->anki->>basicCue.ilike.${pattern})`,
    limit: "100",
  });
  for (let offset = 0; ; offset += 100) {
    params.set("offset", String(offset));
    const rows = await accountFetch<VocabularyRow[]>("user_data_objects?" + params);
    for (const original of rows) {
      let row = original;
      for (let retry = 0; retry < 3; retry++) {
        if (row.deleted_at || !row.payload?.anki || row.payload.id !== row.object_key
          || typeof row.payload.word !== "string" || typeof row.payload.sourceSentence !== "string") break;
        const payload = reconcileStandaloneVocabulary(row.payload, snapshot);
        if (payload === row.payload) break;
        const [written] = await writeSyncObjects(userId, [{
          kind: "vocabulary", objectKey: row.object_key, payload,
          clientUpdatedAt: payload.updatedAt, serverVersion: Number(row.server_version || 0),
        }]);
        if (!written) throw new Error("Vocabulary snapshot write returned no result.");
        if (written.accepted || written.deletedAt) break;
        row = { object_key: written.objectKey, payload: written.payload as VocabularyEntry,
          server_version: written.serverVersion || 0, deleted_at: written.deletedAt || null };
      }
    }
    if (rows.length < 100) return;
  }
}

export async function persistDictionaryResult(userId: string, result: DictionaryResult): Promise<StandaloneDictionaryCacheItem | null> {
  const item = normalizeStandaloneDictionaryCacheItem({
    schemaVersion: 2, query: result.query, result, updatedAt: new Date().toISOString(),
  });
  if (!item) return null;
  const { key, row } = await cacheRow(userId, result.query);
  // Existing protocol-2 CAS handles concurrent device writes; never replace a
  // newer result by bypassing the account's merge contract.
  const [written] = await writeSyncObjects(userId, [{
    kind: "preferences", objectKey: key, payload: item,
    clientUpdatedAt: item.updatedAt, serverVersion: Number(row?.server_version || 0),
  }]);
  const winner = written?.accepted ? item : normalizeStandaloneDictionaryCacheItem(written?.payload);
  if (!winner || written?.deletedAt || winner.normalizedQuery !== item.normalizedQuery) {
    throw new Error("Dictionary snapshot was not durably stored.");
  }
  // The accepted cache remains authoritative even if the secondary projection
  // is temporarily unavailable. A normal client sync also reconciles this pair.
  await updateSavedVocabulary(userId, winner).catch(error => {
    console.error("Saved vocabulary dictionary projection failed", error);
  });
  return winner;
}
