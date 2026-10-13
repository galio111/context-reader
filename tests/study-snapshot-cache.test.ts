import test from "node:test";
import assert from "node:assert/strict";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createStudySnapshotCache, clearStudySnapshotCache, STUDY_SNAPSHOT_MAX_AGE_MS } from "../lib/studySnapshotCache";
import { DEFAULT_STUDY_SETTINGS, newMemory, shanghaiDay } from "../lib/studyScheduler";
import type { StudySnapshot } from "../types/study";

function snapshot(word = "alpha", now = new Date()): StudySnapshot {
  return {
    serverNow: now.toISOString(), settings: DEFAULT_STUDY_SETTINGS,
    cards: [{ id: "card", entry_id: word, mode: "basic_en_to_cn", memory: newMemory(now), version: 0, suspended: false, anki_pending: false, created_at: now.toISOString() }],
    entries: [{ id: word, word, sourceSentence: "", basicMeaning: "释义", contextMeaning: "", anki: { cardMode: "basic_en_to_cn" } }],
    today: { day: shanghaiDay(now), card_ids: ["card"], new_ids: ["card"], settings: DEFAULT_STUDY_SETTINGS, reward_points: 0, completed_at: null },
    reviews: [], daily: [], policy: {}, streak: { current: 0, best: 0, last_day: null }, rewards: [], claims: [],
  } as unknown as StudySnapshot;
}

test("snapshot cache survives a cold client but isolates accounts and excludes presentation envelopes", async () => {
  const factory = new IDBFactory(), value = { ...snapshot(), token: "never-cache-this", snapshot: { token: "nested-envelope" } };
  await createStudySnapshotCache("alice", factory).save(value);
  assert.equal(await createStudySnapshotCache("bob", factory).read(), null);
  const restored = await createStudySnapshotCache("alice", factory).read();
  assert.equal(restored?.entries[0].word, "alpha");
  assert.equal("token" in restored!, false); assert.equal("snapshot" in restored!, false);
});

test("cache expires after 24 hours and a delayed older response cannot replace newer cards", async t => {
  let clock = Date.now(); t.mock.method(Date, "now", () => clock);
  const factory = new IDBFactory(), client = createStudySnapshotCache("alice", factory);
  const first = snapshot("older", new Date(clock)), second = snapshot("newer", new Date(clock + 1000));
  await client.save(second); await client.save(first);
  assert.equal((await client.read())?.entries[0].word, "newer");
  clock += STUDY_SNAPSHOT_MAX_AGE_MS + 1;
  assert.equal(await client.read(), null);
});

test("logout clears all cached accounts and rejects late saves from prior sessions", async t => {
  let clock = Date.now(); t.mock.method(Date, "now", () => clock);
  const factory = new IDBFactory(), alice = createStudySnapshotCache("alice", factory), bob = createStudySnapshotCache("bob", factory);
  await alice.save(snapshot()); await bob.save(snapshot("beta"));
  clock++; await clearStudySnapshotCache(factory);
  await alice.save(snapshot("late")); await bob.save(snapshot("late"));
  clock++;
  const next = createStudySnapshotCache("alice", factory);
  assert.equal(await next.read(), null); assert.equal(await createStudySnapshotCache("bob", factory).read(), null);
  await next.save(snapshot("next-session"));
  assert.equal((await next.read())?.entries[0].word, "next-session");
});

test("unavailable or failed cache storage does not fail the study request path", async () => {
  const client = createStudySnapshotCache("alice", { open() { throw new DOMException("Denied", "SecurityError"); } } as unknown as IDBFactory);
  assert.equal(await client.read(), null);
  await assert.doesNotReject(client.save(snapshot()));
  await assert.doesNotReject(clearStudySnapshotCache({ open() { throw new Error("unavailable"); } } as unknown as IDBFactory));
});

test("an aborted cache write is harmless and never reports an unsaved snapshot on reopen", async t => {
  const factory = new IDBFactory(), client = createStudySnapshotCache("alice", factory);
  const transaction = IDBDatabase.prototype.transaction;
  t.mock.method(IDBDatabase.prototype, "transaction", function (this: IDBDatabase, ...args: Parameters<typeof transaction>) {
    const tx = transaction.apply(this, args);
    if (args[1] === "readwrite") queueMicrotask(() => tx.abort());
    return tx;
  });
  await assert.doesNotReject(client.save(snapshot()));
  assert.equal(await client.read(), null);
});

test("logout tombstones also reject a separate tab's late cache writes", async t => {
  let clock = Date.now(); t.mock.method(Date, "now", () => clock);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/studySnapshotCache.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Date, setTimeout, clearTimeout });
  const otherTab = module.exports as typeof import("../lib/studySnapshotCache");
  const factory = new IDBFactory(), stale = otherTab.createStudySnapshotCache("alice", factory);
  await stale.save(snapshot()); clock++;
  await clearStudySnapshotCache(factory); clock++;
  await stale.save(snapshot("late-private"));
  assert.equal(await createStudySnapshotCache("alice", factory).read(), null);
});

test("schema mismatches and malformed snapshots are ignored", async () => {
  const factory = new IDBFactory(), client = createStudySnapshotCache("alice", factory);
  await client.save(snapshot());
  const db = await new Promise<IDBDatabase>(resolve => { const request = factory.open("context-reader-study-snapshots", 1); request.onsuccess = () => resolve(request.result); });
  async function put(record: object) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite"); tx.objectStore("snapshots").put(record);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
  }
  const row = { key: "owner:alice", owner: "alice", schema: 999, savedAt: Date.now(), snapshot: snapshot() };
  await put(row); assert.equal(await client.read(), null);
  await put({ ...row, schema: 1, snapshot: { serverNow: new Date().toISOString(), entries: [] } });
  assert.equal(await client.read(), null);
  await client.save(snapshot("repair"));
  assert.equal((await client.read())?.entries[0].word, "repair"); db.close();
});
