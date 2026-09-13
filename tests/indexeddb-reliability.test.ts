import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { LearningStorage } from "../lib/learningStorage";
import { pruneAcknowledgedExplanations } from "../lib/learningCachePolicy";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
const A = "context-reader:articles:v1", C = "context-reader:explanations:v5";

test("migration verifies durable rows, preserves unrelated keys and survives a cold reopen", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const articles = [{ id: "a", body: "Original text", metadata: { x: 1 } }, { id: "b", body: "Second" }];
  legacy.setItem(A, JSON.stringify(articles)); legacy.setItem("theme", "night");
  const first = new LearningStorage(legacy, factory); await first.initialize();
  assert.equal(legacy.getItem(A), null); assert.equal(legacy.getItem("theme"), "night");
  assert.deepEqual(JSON.parse(first.getItem(A)!), articles);
  first.close();
  const second = new LearningStorage(legacy, factory); await second.initialize();
  assert.deepEqual(JSON.parse(second.getItem(A)!), articles); second.close();
});

test("two tabs commit different records without replacing each other's collection", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const a = new LearningStorage(legacy, factory), b = new LearningStorage(legacy, factory);
  await a.initialize(); await b.initialize();
  a.setRecord(C, "first", { meaning: "one" }); b.setRecord(C, "second", { meaning: "two" });
  await Promise.all([a.flush(), b.flush()]); await a.reload(); await b.reload();
  assert.deepEqual(JSON.parse(a.getItem(C)!), { first: { meaning: "one" }, second: { meaning: "two" } });
  assert.equal(a.getItem(C), b.getItem(C)); a.close(); b.close();
});

test("an aborted database transaction never reports saved and retained changes can retry", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const store = new LearningStorage(legacy, factory); await store.initialize();
  const db = (store as unknown as { db: IDBDatabase }).db;
  const original = db.transaction.bind(db);
  let fail = true;
  db.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
    const tx = original(...args);
    if (fail && args[1] === "readwrite") { fail = false; queueMicrotask(() => tx.abort()); }
    return tx;
  }) as IDBDatabase["transaction"];
  store.setRecord(C, "pending", { meaning: "retain" });
  await assert.rejects(store.flush());
  assert.equal(store.status.pending, true); assert.ok(store.status.error);
  assert.deepEqual(store.getRecord(C, "pending"), { meaning: "retain" });
  await store.flush(); assert.equal(store.status.pending, false); assert.equal(store.status.error, "");
  store.close();
  const cold = new LearningStorage(legacy, factory); await cold.initialize();
  assert.deepEqual(cold.getRecord(C, "pending"), { meaning: "retain" }); cold.close();
});

test("cache budget evicts acknowledged cold entries only and never removes learning data", async () => {
  const store = new LearningStorage(new MemoryStorage(), new IDBFactory()); await store.initialize();
  store.setItem(A, JSON.stringify([{ id: "protected", body: "Keep forever" }]));
  store.setRecord(C, "cold", { meaning: "old" }); store.setRecord(C, "unsent", { meaning: "pending" }); store.setRecord(C, "hot", { meaning: "recent" });
  store.setRecord("context-reader:cache-access:v1", "hot", 100);
  await store.flush();
  assert.equal(await pruneAcknowledgedExplanations(store, key => key !== "unsent", 2), 1);
  await store.flush(); assert.equal(store.getRecord(C, "cold"), undefined); assert.ok(store.getRecord(C, "unsent")); assert.ok(store.getRecord(C, "hot"));
  assert.equal(JSON.parse(store.getItem(A)!)[0].id, "protected"); store.close();
});

test("account archive preserves unsynced local data while live storage can be cleared", async () => {
  const store = new LearningStorage(new MemoryStorage(), new IDBFactory()); await store.initialize();
  store.setItem(A, JSON.stringify([{ id: "offline", body: "Unsynced text" }])); await store.archiveOwner("owner-a");
  store.removeItem(A); await store.flush(); assert.equal(store.getItem(A), null);
  await store.restoreOwner("owner-a"); assert.equal(JSON.parse(store.getItem(A)!)[0].id, "offline"); store.close();
});

test("a failed offline-cache write never replaces a freshly fetched page with an old release", async () => {
  const cached = new Response("old release", { headers: { "X-SW-Cached-At": String(Date.now()) } });
  const context = vm.createContext({ self: { addEventListener() {} }, caches: { open: async () => ({ put: async () => { throw new DOMException("quota", "QuotaExceededError"); }, keys: async () => [], match: async () => cached }) }, fetch: async () => new Response("new release"), Response, Headers, URL, Date });
  vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  const result = await vm.runInContext('networkFirst({url:"https://context-reader.com/"})', context) as Response;
  assert.equal(await result.text(), "new release");
});

test("a stale tab cannot write another account's database after an owner switch", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const a = new LearningStorage(legacy, factory); await a.initialize(); a.setItem("context-reader:local-account-owner:v1", "a"); await a.flush();
  const b = new LearningStorage(legacy, factory); await b.initialize(); b.setItem("context-reader:local-account-owner:v1", "b"); await b.flush();
  a.setRecord(C, "stale-account", { meaning: "private" });
  await assert.rejects(a.flush(), /账号已在其他标签页切换/);
  await b.reload(); assert.equal(b.getRecord(C, "stale-account"), undefined); a.close(); b.close();
});

test("late writes from an old page are backed up and newer articles survive reopening", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const original = { id: "a", body: "Original", updatedAt: "2026-09-01T00:00:00Z" };
  legacy.setItem(A, JSON.stringify([original]));
  const first = new LearningStorage(legacy, factory); await first.initialize();
  first.setItem(A, JSON.stringify([{ ...original, body: "New database edit", updatedAt: "2026-09-13T00:00:00Z" }])); await first.flush(); first.close();
  legacy.setItem(A, JSON.stringify([original, { id: "b", body: "Late old-tab save", updatedAt: "2026-09-12T00:00:00Z" }]));
  const second = new LearningStorage(legacy, factory); await second.initialize();
  const articles = JSON.parse(second.getItem(A)!);
  assert.equal(articles.find((a: {id:string}) => a.id === "a").body, "New database edit");
  assert.equal(articles.find((a: {id:string}) => a.id === "b").body, "Late old-tab save");
  assert.equal(legacy.getItem(A), null); second.close();
});
