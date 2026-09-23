import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import * as React from "react";
import type { WordContext } from "../types/reader";

test("real CET events preserve drafts, freeze one passage and start an independent self-test", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com", pretendToBeVisual: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, React, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window) })) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  dom.window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = (module) => { module.exports = {}; };
  const mockModule = (path: string, exports: object) => { const filename = require.resolve(path); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule; };
  // Only the pre-existing account/Reader shell is replaced; CetReader events,
  // its dialogs, pure model and IndexedDB persistence are the real modules.
  mockModule("../components/AccountProvider", { useAccount: () => ({ account: { authenticated: false, profile: null }, openLogin() {} }) });
  mockModule("../components/ReaderView", { ReaderView: ({ examSurface }: { examSurface: { render: (lookup: (word: WordContext) => void) => React.ReactNode; rail: React.ReactNode; toolbar: React.ReactNode; menu: React.ReactNode } }) => <>{examSurface.rail}{examSurface.toolbar}{examSurface.menu}{examSurface.render(() => {})}</> });
  const { CetReader } = await import("../components/cet/CetReader");
  const { readCetActivities } = await import("../lib/cetActivityStorage");
  const { getLearningStorage, isLearningStorage } = await import("../lib/learningStorage");
  const { render, waitFor, cleanup } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ paper });
  const noop = () => {};
  const props = { entry: { paperId: paper.id }, onOpen: noop, onBack: noop, savedArticles: [], onArticleSaved: noop, onOpenSavedArticle: noop, onRenameSavedArticle: noop, onDeleteSavedArticle: noop, onOpenImportedArticle: noop };
  const ui = render(<CetReader {...props} />);
  try {
    const user = userEvent.setup({ document: dom.window.document });
    await waitFor(() => assert.ok(ui.getByRole("button", { name: "开始练习", exact: true })));
    assert.equal(readCetActivities().length, 0);
    await user.dblClick(ui.getByRole("button", { name: "开始练习", exact: true }));
    await waitFor(() => assert.equal(readCetActivities().length, 1));
    await user.click(ui.getByRole("button", { name: "第 26 空，未作答" }));
    await user.click(ui.getByRole("button", { name: /^C\s*chance$/ }));
    assert.equal(ui.queryByText(/原答案/), null);
    assert.equal(ui.queryByRole("link", { name: /参考答案/ }), null);
    await user.click(ui.getByRole("button", { name: "提交本篇", exact: true }));
    await user.click(ui.getByRole("button", { name: "返回继续" }));
    assert.ok(ui.getByRole("button", { name: "第 26 空，C" }));
    await user.click(ui.getByRole("button", { name: "提交本篇", exact: true }));
    await user.click(ui.getByRole("button", { name: "提交并查看解析" }));
    await waitFor(() => assert.equal((ui.getByRole("button", { name: "第 26 空，C" }) as HTMLButtonElement).disabled, true));
    await user.click(ui.getByRole("button", { name: "下一篇 →" }));
    assert.ok(ui.getByRole("button", { name: "提交本篇", exact: true }));
    assert.equal(ui.queryByRole("link", { name: /参考答案/ }), null);
    await user.click(ui.getByRole("button", { name: /重新练习保留本轮记录/ }));
    await user.click(ui.getByRole("button", { name: "开始新一轮" }));
    await waitFor(() => assert.ok(ui.getByRole("button", { name: "开始新自测" })));
    await user.click(ui.getByRole("button", { name: "开始新自测" }));
    await waitFor(() => assert.equal(readCetActivities().length, 2));
    const selfTest = readCetActivities().find((a) => a.purpose === "self_test")!;
    assert.deepEqual(selfTest.answers, {});
    assert.ok(selfTest.knownPriorSectionIds.length);
    assert.ok(ui.getByRole("button", { name: "第 26 空，未作答" }));
    assert.equal(ui.queryByRole("link", { name: /参考答案/ }), null);
  } finally {
    cleanup(); globalThis.fetch = originalFetch;
    const storage = getLearningStorage(); if (isLearningStorage(storage)) storage.close();
    dom.window.close();
  }
});
