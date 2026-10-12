import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { getLearningStorage, initializeLearningStorage, isLearningStorage, LearningStorage } from "../lib/learningStorage";
import { createArticleTranslationBlockCacheKey, getCachedArticleTranslation, getCachedArticleTranslationForBlocks, removeCachedArticleTranslation, removeCachedArticleTranslationForBlocks, setCachedArticleTranslation, setCachedArticleTranslationForBlocks } from "../lib/cache";
import { getArticleTranslationJobSnapshot, startArticleTranslationJob } from "../lib/articleTranslationJobs";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "../types/reader";

const FULL = "context-reader:article-translations:v1";
const BLOCK = "context-reader:article-translation-blocks:v1";
const one: ArticleTranslationBlock = { id: "audit-one", type: "paragraph", text: "Careful readers preserve context." };
const two: ArticleTranslationBlock = { id: "audit-two", type: "paragraph", text: "A later paragraph adds detail." };
const translation = (block: ArticleTranslationBlock, text: string): ArticleTranslationItem & Pick<ArticleTranslationBlock, "type"> => ({ id: block.id, type: block.type, translation: text });
async function browserFixture(run: (dom: JSDOM, factory: IDBFactory) => Promise<void>) {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  const original = new Map(["window", "document", "CustomEvent"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of original.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  const factory = new IDBFactory(); Object.defineProperty(dom.window, "indexedDB", { value: factory });
  const originalFetch = globalThis.fetch;
  try { await run(dom, factory); }
  finally { const storage = getLearningStorage(); if (isLearningStorage(storage)) { await storage.flush(); storage.close(); } globalThis.fetch = originalFetch; dom.window.close(); for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}

test("translation cache migrates legacy records, preserves unknown neighbours and survives removal plus cold reopen", async () => browserFixture(async (dom, factory) => {
  const original = translation(one, "读者保留上下文。");
  dom.window.localStorage.setItem(FULL, JSON.stringify({ old: [original], neighbour: [translation(two, "邻居译文。")] }));
  dom.window.localStorage.setItem(BLOCK, JSON.stringify({ [createArticleTranslationBlockCacheKey(one)]: original }));
  dom.window.localStorage.setItem("unrelated-user-data", "retain");
  await initializeLearningStorage();
  assert.deepEqual(getCachedArticleTranslation("old"), [original]);
  assert.deepEqual(getCachedArticleTranslationForBlocks([one]), [original]);
  const replacement = translation(one, "新译文。");
  setCachedArticleTranslation("old", [replacement]); setCachedArticleTranslationForBlocks([one, two], [replacement, translation(two, "第二段。")]);
  removeCachedArticleTranslation("old"); removeCachedArticleTranslationForBlocks([one]);
  const storage = getLearningStorage(); assert.ok(isLearningStorage(storage)); await storage.flush();
  const cold = new LearningStorage(dom.window.localStorage, factory); await cold.initialize();
  try {
    assert.deepEqual(JSON.parse(cold.getItem(FULL)!), { neighbour: [translation(two, "邻居译文。")] });
    assert.deepEqual(JSON.parse(cold.getItem(BLOCK)!), { [createArticleTranslationBlockCacheKey(two)]: translation(two, "第二段。") });
    assert.equal(dom.window.localStorage.getItem("unrelated-user-data"), "retain");
  } finally { cold.close(); }
}));

test("translation cache reads are detached, ordered by requested blocks and keyed by text identity", async () => browserFixture(async () => {
  await initializeLearningStorage();
  const values = [translation(two, "第二段。"), translation(one, "第一段。")];
  setCachedArticleTranslationForBlocks([one, two], values);
  const read = getCachedArticleTranslationForBlocks([one, two]);
  assert.deepEqual(read.map(item => item.id), [one.id, two.id]);
  read[0].translation = "caller mutation";
  assert.equal(getCachedArticleTranslationForBlocks([one])[0].translation, "第一段。");
  assert.deepEqual(getCachedArticleTranslationForBlocks([{ ...one, text: one.text + " Changed." }]), []);
  setCachedArticleTranslationForBlocks([one], [translation(one, "  "), translation(two, "unknown to this call")]);
  assert.equal(getCachedArticleTranslationForBlocks([one])[0].translation, "第一段。");
}));

test("failed regeneration keeps all previously completed translations and finishes its single action as failed", async () => browserFixture(async () => {
  await initializeLearningStorage();
  const key = "audit-failure-" + crypto.randomUUID(), initial = [translation(one, "已有结果。")];
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body)); calls.push({ path, body });
    if (path.endsWith("/start")) return Response.json({ actionId: body.actionId, source: "generated" });
    if (path.endsWith("/finish")) return Response.json({ ok: true });
    return Response.json({ code: "quota_exceeded", error: "额度不足" }, { status: 403 });
  };
  await startArticleTranslationJob(key, [one, two], { force: true, initialTranslations: initial });
  assert.deepEqual(getArticleTranslationJobSnapshot(key)?.translations, initial);
  assert.deepEqual(getCachedArticleTranslation(key), initial);
  assert.equal(getArticleTranslationJobSnapshot(key)?.completedTargetBlocks, 0);
  assert.equal(calls.filter(call => call.path.endsWith("/start")).length, 1);
  assert.deepEqual(calls.filter(call => call.path.endsWith("/finish")).map(call => call.body.status), ["failed"]);
}));

test("late cancelled stream cannot overwrite a newer forced translation in durable cache", async () => browserFixture(async () => {
  await initializeLearningStorage();
  const key = "audit-force-" + crypto.randomUUID(); let requests = 0;
  let releaseOld!: () => void;
  const oldWait = new Promise<void>(resolve => { releaseOld = resolve; });
  globalThis.fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body));
    if (path.endsWith("/start")) return Response.json({ actionId: body.actionId, source: "generated" });
    if (path.endsWith("/finish")) return Response.json({ ok: true });
    const current = ++requests;
    if (current === 1) await oldWait;
    const value = translation(one, current === 1 ? "已取消旧请求。" : "最新强制结果。");
    return new Response(JSON.stringify({ type: "translation", translation: value }) + "\n");
  };
  const oldJob = startArticleTranslationJob(key, [one]);
  while (requests === 0) await new Promise(resolve => setTimeout(resolve, 1));
  await startArticleTranslationJob(key, [one], { force: true });
  releaseOld(); await oldJob;
  assert.equal(getArticleTranslationJobSnapshot(key)?.translations[0].translation, "最新强制结果。");
  assert.equal(getCachedArticleTranslation(key)?.[0].translation, "最新强制结果。");
  assert.equal(getCachedArticleTranslationForBlocks([one])[0].translation, "最新强制结果。");
}));

test("translation snapshots and completed jobs remain private when another owner opens identical content", async () => browserFixture(async () => {
  await initializeLearningStorage(); const storage = getLearningStorage();
  storage.setItem("context-reader:local-account-owner:v1", "owner-a");
  const key = "audit-owner-" + crypto.randomUUID();
  globalThis.fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body));
    if (path.endsWith("/start")) return Response.json({ actionId: body.actionId, source: "generated" });
    if (path.endsWith("/finish")) return Response.json({ ok: true });
    return new Response(JSON.stringify({ type: "translation", translation: translation(one, "账号A的译文。") }) + "\n");
  };
  await startArticleTranslationJob(key, [one]);
  assert.equal(getArticleTranslationJobSnapshot(key)?.translations[0].translation, "账号A的译文。");
  storage.setItem("context-reader:local-account-owner:v1", "owner-b");
  assert.equal(getArticleTranslationJobSnapshot(key), null, "same article cache key must not expose a previous owner's job");
}));

test("owner A to B to A round trip cannot revive an old pending translation response", async () => browserFixture(async () => {
  await initializeLearningStorage(); const storage = getLearningStorage();
  storage.setItem("context-reader:local-account-owner:v1", "owner-a");
  const key = "audit-owner-roundtrip-" + crypto.randomUUID(); let requested = false;
  let releaseOld!: () => void; const wait = new Promise<void>(resolve => { releaseOld = resolve; });
  globalThis.fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body));
    if (path.endsWith("/start")) return Response.json({ actionId: body.actionId, source: "generated" });
    if (path.endsWith("/finish")) return Response.json({ ok: true });
    requested = true; await wait;
    return new Response(JSON.stringify({ type: "translation", translation: translation(one, "不允许复活的旧结果。") }) + "\n");
  };
  const pending = startArticleTranslationJob(key, [one]);
  while (!requested) await new Promise(resolve => setTimeout(resolve, 1));
  storage.setItem("context-reader:local-account-owner:v1", "owner-b");
  storage.removeItem(FULL); storage.removeItem(BLOCK);
  storage.setItem("context-reader:local-account-owner:v1", "owner-a");
  releaseOld(); await pending;
  assert.equal(getCachedArticleTranslation(key), null);
  assert.deepEqual(getCachedArticleTranslationForBlocks([one]), []);
  assert.equal(getArticleTranslationJobSnapshot(key), null);
}));
