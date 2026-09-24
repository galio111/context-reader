import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useArticleReveal } from "../components/useArticleReveal";
import { normalizeCetLibraryView, readCetLibraryView, writeCetLibraryView } from "../lib/cetLibraryView";

test("same articles regain reveal after repeated CET tab remounts and old observers disconnect", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://context-reader.com" });
  const saved = new Map(["window", "document", "IntersectionObserver", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const observers: FakeObserver[] = [];
  class FakeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
    observe(node: Element) { this.targets.add(node); }
    disconnect() { this.targets.clear(); }
    emit(node: Element, visible: boolean) { this.callback([{ target: node, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IntersectionObserver: FakeObserver, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: FakeObserver });
  const frames = new Map<number, FrameRequestCallback>(); let frame = 0;
  dom.window.requestAnimationFrame = callback => { frames.set(++frame, callback); return frame; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  const tick = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(0)); };
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  function Harness({ tab, expanded = false }: { tab: "articles" | "cet"; expanded?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useArticleReveal(ref, "article-card", tab, expanded ? "expanded-article-ids" : "unchanged-article-ids", "recommended");
    return tab === "articles"
      ? createElement("div", { ref }, ...Array.from({ length: expanded ? 420 : 1 }, (_, index) => createElement("button", { key: index, className: "article-card" }, `Article ${index}`)))
      : createElement("p", null, "CET");
  }
  for (let round = 0; round < 4; round++) {
    await act(async () => root.render(createElement(Harness, { tab: "articles" })));
    const card = host.querySelector<HTMLElement>("button")!;
    assert.equal(card.dataset.motionReady, "true");
    assert.equal(card.dataset.visible, undefined);
    tick(); assert.equal(observers.filter(o => o.targets.size).length, 0);
    tick(); assert.equal(observers.filter(o => o.targets.size).length, 1);
    const observer = observers.at(-1)!;
    observer.emit(card, true); assert.equal(card.dataset.visible, "true");
    observer.emit(card, false); assert.equal(card.dataset.visible, undefined);
    observer.emit(card, true); assert.equal(card.dataset.visible, "true");
    await act(async () => root.render(createElement(Harness, { tab: "cet" })));
    assert.equal(observers.filter(o => o.targets.size).length, 0);
    assert.equal(frames.size, 0);
  }
  await act(async () => root.render(createElement(Harness, { tab: "articles" })));
  tick(); tick();
  const existing = host.querySelector<HTMLElement>("button")!;
  observers.at(-1)!.emit(existing, true);
  await act(async () => root.render(createElement(Harness, { tab: "articles", expanded: true })));
  assert.equal(existing.dataset.visible, "true", "appending must preserve visible existing cards");
  const deepCard = host.querySelectorAll<HTMLElement>("button")[419];
  assert.equal(deepCard.dataset.motionReady, "true", "deep library cards must start at the reset keyframe");
  tick(); tick();
  const expandedObserver = observers.at(-1)!;
  assert.equal(expandedObserver.targets.size, 420, "one observer should cover the complete expanded library");
  expandedObserver.emit(deepCard, true);
  assert.equal(deepCard.dataset.visible, "true");
  expandedObserver.emit(deepCard, false);
  assert.equal(deepCard.dataset.visible, undefined, "leaving the viewport must reset the motion");
  expandedObserver.emit(deepCard, true);
  assert.equal(deepCard.dataset.visible, "true", "re-entering must replay the motion");
});

test("featured and expanded recommendations retain their entry, exit and pointer-motion contracts", () => {
  const component = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../components/HomeRedesign.module.css", import.meta.url), "utf8");
  assert.match(component, /useArticleReveal\(articleGridRef, styles\.articleCard, resourceTab, `\$\{activeCategory\}.*\$\{displayArticleMotionKey\}`, activeCategory\)/);
  assert.match(component, /motion3dEnabled=\{recommendationMotionEnabled\}/);
  assert.match(styles, /\.articleCard\[data-motion-ready\]:not\(\[data-visible\]\) \.coverSurface \{ opacity: \.28; \}/);
  assert.match(styles, /\.articleCard\[data-visible="true"\] \.coverSurface \{ opacity: 1; \}/);
  assert.doesNotMatch(styles, /\.articleGrid\[data-library-expanded\] \.coverSurface/);
});

test("CET library filters survive remounts without storing answers and tolerate blocked storage", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  try {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: dom.window.sessionStorage });
    const state = { level: 6, view: "type", type: "detail", year: "2023", page: 2 } as const;
    writeCetLibraryView(state); assert.deepEqual(readCetLibraryView(), { ...state, page: 0 });
    assert.deepEqual(normalizeCetLibraryView({ level: 1, type: "script", year: "<script>", page: -1 }), { level: 4, view: "paper", type: "cloze", year: "recent", page: 0 });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw Error("blocked"); } });
    assert.doesNotThrow(() => writeCetLibraryView(state));
    assert.equal(readCetLibraryView().level, 4);
  } finally { dom.window.close(); if (saved) Object.defineProperty(globalThis, "sessionStorage", saved); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
