import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { explanationFromSync, explanationSyncIdentity } from "../lib/explanationSyncIdentity";
import { createExplanationCacheKey } from "../lib/cache";
import { JSDOM } from "jsdom";
import { syncAccountData } from "../lib/accountSyncClient";
import { readStoredArticles, writeStoredArticles } from "../lib/articleStorage";
import type { AccountSyncObject } from "../types/account";
import { beginForegroundLookup, createExplanationStreamStore, hasForegroundLookup } from "../lib/explanationStreamStore";
import { parseExplanationStream } from "../lib/explanationDisplay";
import { createElement, useSyncExternalStore, act } from "react";
import { createRoot } from "react-dom/client";

test("formatted provider fields become visible before stream completion", () => {
  const partial = "```text\n1. **基础释义**：知识\n- **当前语境含义：** 经验";
  assert.deepEqual(parseExplanationStream(partial), [
    { label: "基础释义", value: "知识" },
    { label: "当前语境含义", value: "经验" },
  ]);
});

test("foreground lookup releases background work on completion and cancellation", () => {
  const first = new AbortController();
  const second = new AbortController();
  const finishFirst = beginForegroundLookup(first.signal);
  const finishSecond = beginForegroundLookup(second.signal);
  assert.equal(hasForegroundLookup(), true);
  first.abort();
  finishFirst();
  assert.equal(hasForegroundLookup(), true);
  finishSecond();
  assert.equal(hasForegroundLookup(), false);
});

test("progressive stream updates rerender the panel without rerendering its article parent", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://context-reader.com" });
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const store = createExplanationStreamStore();
  let parentRenders = 0;
  function Panel() {
    return createElement("div", null, useSyncExternalStore(store.subscribe, store.getSnapshot));
  }
  function Article() { parentRenders++; return createElement(Panel); }
  await act(async () => root.render(createElement(Article)));
  for (let index = 1; index <= 20; index++) {
    await act(async () => store.setText((text) => text + "字"));
    assert.equal(host.textContent?.length, index);
  }
  assert.equal(parentRenders, 1);
});

test("long sentence cache survives bounded sync identity and second-device replay", async () => {
  const sentence = "The researchers examined how communities preserve their knowledge across generations, ".repeat(15);
  const key = createExplanationCacheKey("knowledge", sentence);
  assert.ok(key.length > 500); // rejected by the previous sync API
  const explanation = { word: "knowledge", contextMeaning: "知识" };
  const wire = await explanationSyncIdentity(key, explanation);
  assert.ok(wire.objectKey.length <= 500);
  const replay = explanationFromSync(wire.objectKey, JSON.parse(JSON.stringify(wire.payload)));
  assert.equal(replay.cacheKey, key);
  assert.deepEqual(replay.explanation, explanation);
  assert.deepEqual(await explanationSyncIdentity(replay.cacheKey, replay.explanation), wire);
  assert.notEqual((await explanationSyncIdentity(key + "different", explanation)).objectKey, wire.objectKey);
});

test("short legacy cache identity remains compatible", async () => {
  const key = "word::a sentence";
  const value = { contextMeaning: "词" };
  assert.deepEqual(await explanationSyncIdentity(key, value), { objectKey: key, payload: value });
  assert.deepEqual(explanationFromSync(key, value), { cacheKey: key, explanation: value });
});

test("summary includes longest published article and sends full body", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../app/api/summarize-article/route.ts", import.meta.url), "utf8");
  const clientLimit = Number(reader.match(/AUTO_SUMMARY_MAX_ARTICLE_CHARS = ([\d_]+)/)![1].replaceAll("_", ""));
  const serverLimit = Number(server.match(/MAX_ARTICLE_CHARS = ([\d_]+)/)![1].replaceAll("_", ""));
  assert.equal(clientLimit, serverLimit);
  assert.ok(clientLimit >= 39_519);
  assert.match(server, /content: article,/);
  assert.doesNotMatch(server, /article\.slice\(0, MAX_ARTICLE_CHARS\)/);
});

test("a long lookup no longer blocks article upload, second-device sync, or the next logout sync", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalEvent = globalThis.CustomEvent;
  const devices = [new JSDOM("", { url: "https://context-reader.com" }), new JSDOM("", { url: "https://context-reader.com" })];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.CustomEvent = originalEvent;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    devices.forEach((device) => device.window.close());
  });
  const selectDevice = (index: number) => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: devices[index].window });
    globalThis.CustomEvent = devices[index].window.CustomEvent as typeof CustomEvent;
  };
  const cloud = new Map<string, AccountSyncObject>();
  let writes = 0;
  globalThis.fetch = (async (input, init) => {
    if (init?.method === "POST") {
      const objects = JSON.parse(String(init.body)).objects as AccountSyncObject[];
      // This is the actual server boundary that rejected the old cache key.
      assert.ok(objects.every((object) => object.objectKey.length <= 500));
      writes += objects.length;
      const results = objects.map((object) => ({ ...object, serverVersion: object.serverVersion + 1, accepted: true }));
      for (const object of results) cloud.set(`${object.kind}:${object.objectKey}`, object);
      return Response.json({ objects: results });
    }
    const deleted = String(input).includes("bootstrap=deleted");
    return Response.json({ objects: deleted ? [] : [...cloud.values()], nextOffset: null, snapshotCursor: "", nextCursor: "", hasMore: false });
  }) as typeof fetch;
  selectDevice(0);
  const key = createExplanationCacheKey("knowledge", "A very long sentence containing knowledge, ".repeat(25));
  const explanation = { word: "knowledge", contextMeaning: "知识" };
  window.localStorage.setItem("context-reader:explanations:v5", JSON.stringify({ [key]: explanation }));
  const article = { id: "incident-test", title: "Test", summary: "", body: "This article must sync.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeStoredArticles(window.localStorage, [article]);
  const first = await syncAccountData();
  assert.equal(first.pushedCount, 2);
  selectDevice(1);
  await syncAccountData();
  assert.equal(readStoredArticles(window.localStorage)[0].body, article.body);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("context-reader:explanations:v5")!)[key], explanation);
  const logoutSync = await syncAccountData();
  assert.equal(logoutSync.pushedCount, 0);
  assert.equal(writes, 2, "replay must not create duplicate cache uploads");
});
