"use client";

import type { StudySnapshot } from "@/types/study";

const DATABASE = "context-reader-study-snapshots";
const STORE = "snapshots";
const SCHEMA = 1;
export const STUDY_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let generation = 0;

type CachedSnapshot = { key: string; owner: string; schema: number; savedAt: number; snapshot: StudySnapshot };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");
function validSnapshot(value: unknown): value is StudySnapshot {
  if (!object(value) || !Number.isFinite(Date.parse(String(value.serverNow)))) return false;
  if (!object(value.settings) || !object(value.policy) || !object(value.streak)) return false;
  if (![value.cards, value.entries, value.reviews, value.daily, value.rewards, value.claims].every(Array.isArray)) return false;
  if (value.today !== null && (!object(value.today) || !Array.isArray(value.today.card_ids) || !Array.isArray(value.today.new_ids))) return false;
  return (value.cards as unknown[]).every(card => object(card) && typeof card.id === "string" && typeof card.entry_id === "string" && object(card.memory) && typeof card.memory.due === "string" && typeof card.memory.state === "number")
    && (value.entries as unknown[]).every(entry => object(entry) && typeof entry.id === "string" && typeof entry.word === "string" && typeof entry.sourceSentence === "string" && typeof entry.basicMeaning === "string" && typeof entry.contextMeaning === "string" && object(entry.anki));
}

function browserDatabase(): IDBFactory | undefined {
  try { return typeof indexedDB === "undefined" ? undefined : indexedDB; } catch { return undefined; }
}

async function open(factory: IDBFactory | undefined): Promise<IDBDatabase | null> {
  if (!factory) return null;
  return new Promise(resolve => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true; clearTimeout(timer); resolve(db);
    };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" }); };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

/** A view cache only. Creating a client does not restore any account or review authority. */
export function createStudySnapshotCache(owner: string, factory = browserDatabase()) {
  const startedAt = Date.now(), sessionGeneration = generation;
  const key = "owner:" + owner;
  const active = () => Boolean(owner) && sessionGeneration === generation;
  async function access(snapshot?: StudySnapshot): Promise<StudySnapshot | null> {
    if (!active()) return null;
    const db = await open(factory);
    if (!db) return null;
    try {
      if (!active()) return null;
      return await new Promise<StudySnapshot | null>(resolve => {
        const tx = db.transaction(STORE, snapshot ? "readwrite" : "readonly"), store = tx.objectStore(STORE);
        const record = store.get(key), cleared = store.get("cleared");
        let result: StudySnapshot | null = null, reads = 0;
        const ready = () => {
          if (++reads !== 2 || !active() || (cleared.result?.at ?? 0) >= startedAt) return;
          const cached = record.result as CachedSnapshot | undefined;
          if (snapshot) {
            if (!validSnapshot(snapshot) || (cached?.schema === SCHEMA && validSnapshot(cached.snapshot) && Date.parse(cached.snapshot.serverNow) > Date.parse(snapshot.serverNow))) return;
            // Select snapshot fields explicitly: presentation tokens and API envelopes never persist.
            const { serverNow, settings, cards, entries, today, reviews, daily, policy, streak, rewards, claims, ankiPendingCount } = snapshot;
            store.put({ key, owner, schema: SCHEMA, savedAt: Date.now(), snapshot: { serverNow, settings, cards, entries, today, reviews, daily, policy, streak, rewards, claims, ankiPendingCount } } satisfies CachedSnapshot);
          } else if (cached?.owner === owner && cached.schema === SCHEMA && Date.now() >= cached.savedAt && Date.now() - cached.savedAt <= STUDY_SNAPSHOT_MAX_AGE_MS && validSnapshot(cached.snapshot)) {
            result = cached.snapshot;
          }
        };
        const safelyReady = () => { try { ready(); } catch { tx.abort(); } };
        record.onsuccess = safelyReady; cleared.onsuccess = safelyReady;
        tx.oncomplete = () => resolve(active() ? result : null);
        tx.onerror = tx.onabort = () => resolve(null);
      });
    } catch { return null; }
    finally { db.close(); }
  }
  return { read: () => access(), save: async (snapshot: StudySnapshot) => { await access(snapshot); } };
}

/** Logout clears this disposable cache without touching the durable answer outbox. */
export async function clearStudySnapshotCache(factory = browserDatabase()): Promise<void> {
  generation++;
  const db = await open(factory);
  if (!db) return;
  try {
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      store.clear();
      // Old pages in other tabs cannot repopulate the cache after this logout.
      store.put({ key: "cleared", at: Date.now() });
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => resolve();
    });
  } catch { /* A disposable cache never blocks account cleanup. */ }
  finally { db.close(); }
}
