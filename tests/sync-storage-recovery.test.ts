import { IDBFactory } from "fake-indexeddb";
import { getLearningStorage } from "../lib/learningStorage";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import LZString from "lz-string";
import { syncAccountData } from "../lib/accountSyncClient";
import { readStoredArticles, writeStoredArticles } from "../lib/articleStorage";
import type { AccountSyncObject } from "../types/account";

const STATE = "context-reader:sync-state:v2";
const RECOVERY = "context-reader:sync-storage-recovery:20260913";
const VOCAB = "context-reader:vocabulary:v1";
const decode = (raw: string) => JSON.parse(raw.startsWith("lz-utf16:") ? LZString.decompressFromUTF16(raw.slice(9))! : raw);

test("bounded storage replay, missing local records, and incomplete upload acknowledgements", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalEvent = globalThis.CustomEvent;
  const devices: JSDOM[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.CustomEvent = originalEvent;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    devices.forEach(device => device.window.close());
  });
  const fixture = process.env.SYNC_PRIVATE_FIXTURE;
  const at = "2026-09-13T00:00:00.000Z";
  const snapshot: Record<string, string> = fixture ? JSON.parse(readFileSync(join(fixture, "chrome-origin-snapshot.json"), "utf8")) : {};
  let objects: AccountSyncObject[];
  let authority: { articles: unknown[]; vocabulary: unknown[] };
  if (fixture) {
    authority = JSON.parse(readFileSync(join(fixture, "chrome-authority.json"), "utf8"));
    objects = readFileSync(join(fixture, "cloud-before.jsonl"), "utf8").trim().split(/\r?\n/).map(line => {
      const row = JSON.parse(line);
      return { kind: row.kind, objectKey: row.object_key, payload: row.deleted_at ? {} : row.payload,
        clientUpdatedAt: row.client_updated_at, serverVersion: row.server_version, deletedAt: row.deleted_at || undefined };
    });
  } else {
    const articles = Array.from({ length: 46 }, (_, i) => ({ id: `article-${i}`, title: `Article ${i}`, summary: "", body: `Unique article ${i}. ` + "Reading matters. ".repeat(400), createdAt: at, updatedAt: at, lastOpenedAt: at }));
    authority = { articles, vocabulary: [] };
    objects = articles.map(article => ({ kind: "article", objectKey: article.id, payload: article, clientUpdatedAt: at, serverVersion: 1 }));
    for (let i = 0; i < 18000; i++) objects.push({ kind: "vocabulary", objectKey: `deleted-vocabulary-${i}-previous-device`, payload: {}, clientUpdatedAt: at, serverVersion: 1, deletedAt: at });
    snapshot[STATE] = JSON.stringify({ protocol: 2, initialized: true, cursor: "current", manifest: Object.fromEntries(objects.map(o => [`${o.kind}:${o.objectKey}`, { version: 1, hash: "previoushash", deleted: Boolean(o.deletedAt) }])) });
    snapshot["unrelated:preserve"] = "x".repeat(2_700_000);
  }
  const initialObjects = structuredClone(objects);
  let cloud = new Map(objects.map(object => [`${object.kind}:${object.objectKey}`, object]));
  let incomplete = false;
  globalThis.fetch = (async (input, init) => {
    if (init?.method === "POST") {
      const incoming = JSON.parse(String(init.body)).objects as AccountSyncObject[];
      if (incomplete) return Response.json({ objects: [] });
      const results = incoming.map(object => ({ ...object, serverVersion: object.serverVersion + 1, accepted: true }));
      results.forEach(object => cloud.set(`${object.kind}:${object.objectKey}`, object));
      return Response.json({ objects: results });
    }
    const params = new URL(String(input), "https://context-reader.com").searchParams;
    if (!params.has("bootstrap")) return Response.json({ objects: [], nextCursor: "current", hasMore: false });
    const deleted = params.get("bootstrap") === "deleted";
    const group = params.get("group");
    const learning = new Set(["article", "vocabulary", "reading_state"]);
    const rows = [...cloud.values()].filter(o => Boolean(o.deletedAt) === deleted && (!group || learning.has(o.kind) === (group === "learning")));
    const offset = Number(params.get("offset"));
    return Response.json({ objects: rows.slice(offset, offset + 500), nextOffset: offset + 500 < rows.length ? offset + 500 : null, snapshotCursor: "current" });
  }) as typeof fetch;
  const selectDevice = (seed: Record<string, string>) => {
    const device = new JSDOM("", { url: "https://context-reader.com", storageQuota: 5 * 1024 * 1024 });
    devices.push(device);
    Object.defineProperty(device.window, "indexedDB", { value: new IDBFactory() });
    Object.defineProperty(globalThis, "window", { configurable: true, value: device.window });
    globalThis.CustomEvent = device.window.CustomEvent as typeof CustomEvent;
    Object.entries(seed).forEach(([key, value]) => window.localStorage.setItem(key, value));
  };
  const assertAuthority = () => {
    const sorted = (items: any[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(sorted(readStoredArticles(getLearningStorage())), sorted(authority.articles));
    assert.deepEqual(sorted(decode(getLearningStorage().getItem(VOCAB) || "[]")), sorted(authority.vocabulary));
  };
  for (const scenario of ["existing-near-capacity", "new-device", "stale-device"] as const) {
    cloud = new Map(structuredClone(initialObjects).map(o => [`${o.kind}:${o.objectKey}`, o]));
    selectDevice(scenario === "new-device" ? {} : snapshot);
    if (scenario === "stale-device") {
      writeStoredArticles(window.localStorage, []);
      window.localStorage.setItem(VOCAB, "[]");
      window.localStorage.setItem(RECOVERY, "complete");
      window.localStorage.setItem("context-reader:article-storage-recovery:20260905", "complete");
    }
    const result = await syncAccountData({ reconcile: scenario === "stale-device" });
    assert.equal(result.verified, true, scenario);
    assertAuthority();
    assert.equal(window.localStorage.getItem(STATE), null, "large sync bookkeeping must leave localStorage");
    if (snapshot["unrelated:preserve"] && scenario !== "new-device") assert.equal(window.localStorage.getItem("unrelated:preserve"), snapshot["unrelated:preserve"]);
    console.log(JSON.stringify({ scenario, articleCount: result.articleCount, vocabularyCount: result.vocabularyCount, legacyManifestCharacters: window.localStorage.getItem(STATE)?.length || 0, uploaded: result.pushedCount }));
  }
  selectDevice({});
  writeStoredArticles(window.localStorage, [{ id: "unsent", title: "Unsent", summary: "", body: "Preserve this local article", createdAt: at, updatedAt: at }]);
  cloud.clear();
  incomplete = true;
  const phases: string[] = [];
  await assert.rejects(syncAccountData({ reconcile: true, onProgress: p => phases.push(p.phase) }), /同步服务未确认全部上传数据/);
  assert.ok(!phases.includes("complete"));
  assert.equal(readStoredArticles(getLearningStorage())[0].id, "unsent");
  assert.notEqual(window.localStorage.getItem(RECOVERY), "complete");
});
