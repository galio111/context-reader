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
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = (module) => { module.exports = {}; };
  const mockModule = (path: string, exports: object) => { const filename = require.resolve(path); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule; };
  // Only the pre-existing account/Reader shell is replaced; CetReader events,
  // its dialogs, pure model and IndexedDB persistence are the real modules.
  mockModule("../components/AccountProvider", { useAccount: () => ({ account: { authenticated: false, profile: null }, openLogin() {} }) });
  mockModule("../components/ReaderView", { ReaderView: ({ examSurface }: { examSurface: { render: (lookup: (word: WordContext) => void) => React.ReactNode; rail: React.ReactNode; toolbar: React.ReactNode; timer: React.ReactNode; menu: React.ReactNode } }) => <>{examSurface.rail}{examSurface.timer}{examSurface.toolbar}{examSurface.menu}{examSurface.render(() => {})}</> });
  const { CetReader } = await import("../components/cet/CetReader");
  const { readCetActivities } = await import("../lib/cetActivityStorage");
  const { getLearningStorage, isLearningStorage } = await import("../lib/learningStorage");
  const { render, waitFor, cleanup } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ paper });
  const noop = () => {};
  const props = { entry: { paperId: paper.id }, onOpen: noop, onBack: noop, savedArticles: [], onArticleSaved: noop, onOpenSavedArticle: noop, onRenameSavedArticle: noop, onDeleteSavedArticle: noop, onOpenImportedArticle: () => true };
  const ui = render(<CetReader {...props} />);
  try {
    const user = userEvent.setup({ document: dom.window.document });
    await waitFor(() => assert.ok(ui.getByRole("button", { name: "开始练习" })));
    assert.equal(readCetActivities().length, 0);
    await user.dblClick(ui.getByRole("button", { name: "开始练习" }));
    await waitFor(() => assert.equal(readCetActivities().length, 1));
    // Action placement only; actual Reader geometry is verified separately in a browser.
    const bottomActions=()=>Array.from(ui.container.querySelectorAll('[data-question-actions="inline"] > button')).map(b=>b.getAttribute('data-action'));
    for(const [index,label] of ['选词填空','长篇匹配','仔细阅读 · 1','仔细阅读 · 2'].entries()) {
      await user.click(ui.getByRole('button',{name:label}));
      assert.deepEqual(bottomActions(),index===3?['submit-section','submit-all']:['submit-section']);
      assert.equal(ui.queryByRole('button',{name:'结束练习并精读'}),null);
    }
    await user.click(ui.getByRole('button',{name:'选词填空'}));

    await user.click(ui.getByRole("button", { name: "第 26 空，未作答" }));
    await user.click(ui.getByRole("option", { name: /^C\s*chance$/ }));
    // This checks CetReader dialog lifetime, not the real Reader pointer layer.
    for(let repeat=0;repeat<20;repeat++) {
      await user.click(ui.getAllByRole("button",{name:/^答题卡/})[0]);
      assert.equal(ui.getAllByRole("dialog",{name:"答题卡"}).length,1);
      await user.click(ui.getByRole("button",{name:"关闭答题卡"}));
      assert.equal(ui.queryByRole("dialog",{name:"答题卡"}),null);
    }
    assert.equal(ui.queryByText(/原答案/), null);
    assert.equal(ui.queryByRole("link", { name: /参考答案/ }), null);
    await user.click(ui.getByRole("button", { name: "提交本篇" }));
    await user.click(ui.getByRole("button", { name: "返回继续" }));
    assert.ok(ui.getByRole("button", { name: "第 26 空，C" }));
    await user.click(ui.getByRole("button", { name: "提交本篇" }));
    await user.click(ui.getByRole("button", { name: "提交并查看解析" }));
    await waitFor(() => assert.equal((ui.getByRole("button", { name: "第 26 空，C" }) as HTMLButtonElement).disabled, true));
    await user.click(ui.getByRole("button", { name: "下一篇 →" }));
    assert.ok(ui.getByRole("button", { name: "提交本篇" }));
    assert.equal(ui.queryByRole("link", { name: /参考答案/ }), null);
    // Data/action wiring only: this shell test is not layout or pointer evidence.
    const batchStore = getLearningStorage(); assert.ok(isLearningStorage(batchStore));
    const batchFlush = batchStore.flush.bind(batchStore);
    const existingSnapshot = JSON.stringify(Object.values(readCetActivities()[0].finalizations)[0]);
    await user.click(ui.getAllByRole("button", {name:"提交全部"})[0]);
    assert.ok(ui.getByText(/还有 20 题未答/));
    await user.click(ui.getByRole("button", {name:"返回继续"}));
    assert.equal(Object.keys(readCetActivities()[0].finalizations).length,1);
    batchStore.flush = async () => {throw Error("batch flush failed");};
    await user.click(ui.getAllByRole("button", {name:"提交全部"})[0]);
    await user.click(ui.getByRole("button", {name:"提交全部并查看结果"}));
    await waitFor(() => assert.ok(ui.getByRole("dialog", {name:"保存失败"})));
    assert.equal(ui.queryByRole("button",{name:"全部已提交"}),null);
    const batchIds = Object.keys(readCetActivities()[0].finalizations);
    assert.equal(batchIds.length,4);
    batchStore.flush = batchFlush;
    await user.dblClick(ui.getByRole("button", {name:"重试保存"}));
    await waitFor(() => assert.ok(ui.getByRole("button",{name:"全部已提交"})));
    assert.deepEqual(Object.keys(readCetActivities()[0].finalizations),batchIds);
    assert.equal(JSON.stringify(Object.values(readCetActivities()[0].finalizations)[0]),existingSnapshot);
    await user.click(ui.getByRole("button", { name: /重新练习保留本轮记录/ }));
    await user.click(ui.getByRole("button", { name: "开始新一轮" }));
    await waitFor(() => assert.ok(ui.getByRole("button", { name: "开始套卷自测" })));
    await user.click(ui.getByRole("button", { name: "开始套卷自测" }));
    assert.equal(readCetActivities().length, 1);
    const duration=ui.getByRole("textbox",{name:"自测分钟数"});
    await user.clear(duration);
    await user.click(ui.getByRole("button",{name:"开始自测"}));
    assert.equal(readCetActivities().length,1);
    assert.ok(ui.getByText("请输入 1–180 的整数分钟。"));
    await user.type(duration,"40");
    const reliableStore=getLearningStorage();
    assert.ok(isLearningStorage(reliableStore));
    const realFlush=reliableStore.flush.bind(reliableStore);
    reliableStore.flush=async()=>{throw new Error("injected start persistence failure");};
    await user.click(ui.getByRole("button", { name: "开始自测" }));
    await waitFor(()=>assert.ok(ui.getByText("开始记录未能保存到本机，请重试。")));
    assert.ok(ui.getByRole("dialog",{name:"开始新自测"}));
    assert.equal(ui.queryByRole("button",{name:"第 26 空，未作答"}),null);
    const pendingStartId=readCetActivities().find(a=>a.purpose==='self_test')!.id;
    reliableStore.flush=realFlush;
    await user.dblClick(ui.getByRole("button", { name: "开始自测" }));
    await waitFor(() => assert.equal(readCetActivities().length, 2));
    const selfTest = readCetActivities().find((a) => a.purpose === "self_test")!;
    assert.equal(selfTest.id,pendingStartId);
    for(const [index,label] of ['选词填空','长篇匹配','仔细阅读 · 1','仔细阅读 · 2'].entries()) {
      await user.click(ui.getByRole('button',{name:label}));
      assert.deepEqual(bottomActions(),index===3?['submit-test']:[]);
    }
    await user.click(ui.getByRole('button',{name:'选词填空'}));

    reliableStore.flush=async()=>{throw new Error("injected local persistence failure");};
    await user.click(ui.getByRole("button",{name:"暂停自测计时"}));
    await waitFor(()=>assert.ok(ui.getByText("计时状态未能保存，请重试。")));
    assert.ok(ui.getByRole("button",{name:"第 26 空，未作答"}));
    reliableStore.flush=realFlush;
    await user.click(ui.getByRole("button",{name:"暂停自测计时"}));
    await waitFor(()=>assert.ok(ui.getByText("自测已暂停")));
    assert.equal(ui.queryByRole("button",{name:"第 26 空，未作答"}),null);
    await user.click(ui.getByRole("button",{name:"继续自测计时"}));
    await waitFor(()=>assert.ok(ui.getByRole("button",{name:"第 26 空，未作答"})));
    assert.equal(readCetActivities().filter(a=>a.purpose==='self_test').length,1);

    reliableStore.flush=async()=>{throw new Error("injected submit persistence failure");};
    await user.click(ui.getAllByRole("button",{name:"提交自测"})[0]);
    const {within}=await import("@testing-library/react");
    await user.click(within(ui.getByRole("dialog",{name:"提交自测"})).getByRole("button",{name:"提交自测"}));
    await waitFor(()=>assert.ok(ui.getByRole("dialog",{name:"保存失败"})));
    assert.equal(Boolean(ui.queryByText(/原答案/)),false);
    const pendingCommit=readCetActivities().find(a=>a.id===selfTest.id)!;
    const finalId=Object.keys(pendingCommit.finalizations)[0];
    reliableStore.flush=realFlush;
    await user.click(ui.getByRole("button",{name:"重试保存"}));
    await waitFor(()=>assert.equal(Boolean(ui.queryByRole("dialog",{name:"保存失败"})),false));
    assert.deepEqual(Object.keys(readCetActivities().find(a=>a.id===selfTest.id)!.finalizations),[finalId]);
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
