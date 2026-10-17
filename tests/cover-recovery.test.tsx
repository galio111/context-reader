import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import type { PublicArticle } from "../types/publicArticle";
import { useCoverRecovery } from "../components/useCoverRecovery";

test("cover failures retry silently, stop after two retries, recover online and cancel on unmount", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const timers = new Map<number, { run: () => void; delay: number }>(); let id = 0;
  dom.window.setTimeout = ((run: () => void, delay: number) => { timers.set(++id, { run, delay }); return id; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = (key: number) => { timers.delete(key); };
  let result!: ReturnType<typeof useCoverRecovery>;
  function Probe({ url }: { url: string }) { result = useCoverRecovery(url); return null; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = async (delay: number) => {
    assert.equal(timers.size, 1);
    const [key, timer] = [...timers][0]; assert.equal(timer.delay, delay); timers.delete(key);
    await act(async () => timer.run());
  };
  try {
    await act(async () => root.render(<Probe url="/one.webp" />));
    await act(async () => result.fail()); assert.equal(result.exhausted, false);
    await tick(1000); assert.equal(result.failed, false); assert.equal(result.revision, 1);
    await act(async () => result.fail()); await tick(3000);
    await act(async () => result.fail()); assert.equal(result.exhausted, true); assert.equal(timers.size, 0);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
    assert.equal(result.failed, false); assert.equal(result.revision, 3);
    await act(async () => result.fail()); await tick(1000);
    await act(async () => result.recover()); assert.equal(result.exhausted, false);
    await act(async () => result.fail()); assert.equal(timers.size, 1);
    await act(async () => root.render(<Probe url="/two.webp" />));
    assert.equal(result.failed, false); assert.equal(timers.size, 0);
    await act(async () => result.fail()); assert.equal(timers.size, 1);
  } finally {
    await act(async () => root.unmount()); assert.equal(timers.size, 0);
    dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("real eager cover remounts after transient error and shows fallback only after exhaustion", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "React", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const require = createRequire(import.meta.url); const css = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { ArticleCover } = await import("../components/ArticleCover");
  const timers = new Map<number, () => void>(); let id = 0;
  dom.window.setTimeout = ((run: () => void) => { timers.set(++id, run); return id; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = (key: number) => { timers.delete(key); };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const article = { id: "one", title: "Test", recommendation: { coverImageUrl: "/cover.webp" } } as PublicArticle;
  const fail = async () => act(async () => { dom.window.document.querySelector("img")!.dispatchEvent(new dom.window.Event("error")); });
  const retry = async () => act(async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(run => run()); });
  try {
    await act(async () => root.render(<ArticleCover article={article} priority />));
    const first = dom.window.document.querySelector("img"); assert.ok(first);
    await fail(); assert.equal(dom.window.document.querySelector('[role="status"]'), null);
    await retry(); assert.ok(dom.window.document.querySelector("img")); assert.notEqual(dom.window.document.querySelector("img"), first);
    await fail(); await retry(); await fail();
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!, /封面暂时无法加载/);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("online")));
    const loaded = dom.window.document.querySelector("img")!; assert.ok(loaded);
    Object.defineProperty(loaded, "complete", { value: true }); Object.defineProperty(loaded, "naturalWidth", { value: 480 });
    await act(async () => loaded.dispatchEvent(new dom.window.Event("load")));
    assert.ok(dom.window.document.querySelector('[data-image-ready="true"]'));
    assert.equal(dom.window.document.querySelector('[role="status"]'), null);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (css) require.extensions[".css"] = css; else delete require.extensions[".css"];
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
