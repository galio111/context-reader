import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
import type { DictionaryResult } from "../types/dictionary";

// SOURCE_WORKTREE lets an independent test worktree exercise the implementation
// without copying source files or touching another agent's checkout.
const sourceRoot = process.env.SOURCE_WORKTREE || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(resolve(sourceRoot, "package.json"));
const CHANGED = "context-reader:account-data-changed";
const MERGED = "context-reader:account-data-merged";
const SESSION = "context-reader:standalone-dictionary:session:v3";
type Props = { detailResult?: DictionaryResult; detailUpdatedAt?: string; initialQuery?: string; onRelatedLookup?: (query: string) => void; preload?: boolean; active?: boolean };
type Snapshot = { schemaVersion: 2; query: string; normalizedQuery: string; result: DictionaryResult; updatedAt: string };

function fixture(meaning = "旧释义", query = "retain"): DictionaryResult {
  return { query, lemma: query, phonetic: "/rɪˈteɪn/", phoneticFor: query, direction: "en_to_cn", inputStatus: "valid", suggestedQuery: "",
    senses: [{ partOfSpeech: "verb", meaning, phonetic: "", register: "常用", usageNote: "", exampleEnglish: "We retain the original records.", exampleChinese: "我们保留原始记录。" }],
    verbForms: { pastTense: "retained", pastParticiple: "retained", presentParticiple: "retaining" }, usageGuide: "保留已经拥有的事物。",
    collocations: [{ phrase: "retain control", meaning: "保持控制", exampleEnglish: "They retain control." }],
    synonyms: [{ word: "keep", difference: "日常用词。" }], wordFamily: [{ word: "retention", partOfSpeech: "noun", meaning: "保留" }],
    commonMistakes: ["注意使用及物结构。"], memoryTip: "通过常见搭配记忆。" };
}

function streamBody(result: DictionaryResult, complete = true) {
  return [{ type: "head", ...result }, ...result.senses.map(sense => ({ type: "sense", ...sense })),
    { type: "usage", value: result.usageGuide }, ...result.synonyms.map(value => ({ type: "synonym", ...value })),
    ...(complete ? [{ type: "done" }] : [])].map(line => JSON.stringify(line)).join("\n") + "\n";
}

async function harness() {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, StorageEvent: dom.window.StorageEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let owner = "account-a";
  const caches = new Map<string, Map<string, Snapshot>>();
  const histories = new Map<string, Array<{ query: string; normalizedQuery: string; lastLookedUpAt: string }>>();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const normalized = (query: string) => query.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
  const currentCache = () => { if (!caches.has(owner)) caches.set(owner, new Map()); return caches.get(owner)!; };
  const emit = (type = CHANGED, kinds = ["preferences"]) => dom.window.dispatchEvent(new dom.window.CustomEvent(type, { detail: { kinds } }));
  const snapshot = (result: DictionaryResult, updatedAt = "2000-01-01T00:00:00.000Z"): Snapshot => ({ schemaVersion: 2, query: result.query, normalizedQuery: normalized(result.query), result, updatedAt });
  const save = (result: DictionaryResult, options: { updatedAt?: string } = {}) => {
    const item = snapshot(result, options.updatedAt || new Date().toISOString());
    const existing = currentCache().get(item.normalizedQuery);
    if (existing && existing.updatedAt > item.updatedAt) return existing;
    currentCache().set(item.normalizedQuery, item); emit(); return item;
  };
  const history = () => histories.get(owner) || [];
  const recordHistory = (query: string, intent: { owner?: string } = {}) => {
    if (intent.owner && intent.owner !== owner) return history();
    const row = { query, normalizedQuery: normalized(query), lastLookedUpAt: new Date().toISOString() };
    histories.set(owner, [row, ...history().filter(item => item.normalizedQuery !== row.normalizedQuery)]); emit(); return history();
  };
  const account = () => ({ loading: false, isOffline: false, account: { authenticated: true, profile: { userId: owner } }, localAccount: null, refreshAccount: async () => {}, syncNow: async () => ({ pushedCount: 0, pulledCount: 0 }) });
  let handleFetch: (url: string, init?: RequestInit) => Promise<Response> = async url => {
    if (url.includes("dictionary-history")) return Response.json({ dictionary: null }, { status: 404 });
    throw new Error("Unexpected generation: " + url);
  };
  const storage = { getItem: (key: string) => key === "context-reader:local-account-owner:v1" ? owner : null };
  const overrides: Record<string, unknown> = {
    react: React,
    "./LoadingStatus": { LoadingStatus: ({ children }: { children: React.ReactNode }) => <span role="status">{children}</span> },
    "@/lib/accountUsageNavigation": { openAccountUsage() {}, isQuotaMessage: () => false },
    "@/components/PronunciationButtons": { PronunciationButtons: () => null },
    "@/components/AccountProvider": { useAccount: account },
    "@/components/ClearableField": { default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
    "@/lib/learningStorage": { initializeLearningStorage: async () => storage, flushLearningStorage: async () => {}, getLearningStorage: () => storage },
    "@/lib/accountEvents": { ACCOUNT_DATA_CHANGED_EVENT: CHANGED, ACCOUNT_DATA_MERGED_EVENT: MERGED, accountDataEventKinds: (event: CustomEvent) => event.detail?.kinds || [] },
    "@/lib/standaloneDictionaryCache": { STANDALONE_DICTIONARY_CACHE_KEY: "dictionary-cache", findStandaloneDictionaryCache: (query: string) => currentCache().get(normalized(query))?.result || null,
      findStandaloneDictionaryCacheItem: (query: string) => currentCache().get(normalized(query)) || null, recordStandaloneDictionaryCache: save,
      migrateStandaloneDictionarySessionCache: (results: DictionaryResult[]) => { for (const result of results) if (!currentCache().has(normalized(result.query))) save(result); } },
    "@/lib/standaloneDictionaryHistory": { STANDALONE_DICTIONARY_HISTORY_KEY: "dictionary-history", dictionaryHistoryOwner: () => owner,
      normalizeStandaloneDictionaryQuery: normalized, readStandaloneDictionaryHistory: history, recordStandaloneDictionaryHistory: recordHistory,
      beginDictionaryQuery: () => ({ owner }), migrateStandaloneDictionarySessionHistory: async () => history(), removeStandaloneDictionaryHistory: async () => [] },
    "@/lib/lookupCancellationClient": { notifyLookupCancellation() {} },
    "@/lib/clientErrorReporting": { validateStandaloneDictionaryInput: () => "", describeCaughtRequestError: async () => "查询失败，请稍后重试。", describeApiFailure: async () => "查询失败，请稍后重试。" },
    "./BookDictionary.module.css": { default: {} },
  };
  const loaded = new Map<string, { exports: unknown }>();
  const load = (filename: string): unknown => {
    const known = loaded.get(filename); if (known) return known.exports;
    const module = { exports: {} as unknown }; loaded.set(filename, module);
    const source = readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    const localRequire = (key: string) => {
      if (key in overrides) return overrides[key];
      if (key.startsWith("@/") || key.startsWith(".")) {
        const base = key.startsWith("@/") ? resolve(sourceRoot, key.slice(2)) : resolve(dirname(filename), key);
        const next = [base, base + ".ts", base + ".tsx"].find(value => existsSync(value));
        if (!next) throw new Error("Missing source module: " + key); return load(next);
      }
      return nodeRequire(key);
    };
    runInNewContext(output, { module, exports: module.exports, require: localRequire, React, window: dom.window,
      StorageEvent: dom.window.StorageEvent, CustomEvent: dom.window.CustomEvent, AbortController, TextDecoder, crypto, console,
      ResizeObserver: class { observe() {} disconnect() {} },
      fetch: async (input: string, init?: RequestInit) => { calls.push({ url: String(input), init }); return handleFetch(String(input), init); },
    }, { filename });
    return module.exports;
  };
  const Component = (load(resolve(sourceRoot, "components/BookDictionary.tsx")) as { BookDictionary: React.ComponentType<Props> }).BookDictionary;
  const { render, cleanup, waitFor, act, within } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  return { Component, render, waitFor, act, within, user: userEvent.setup({ document: dom.window.document }), calls, emit, save,
    seed(result: DictionaryResult, at?: string) { currentCache().set(normalized(result.query), snapshot(result, at)); },
    read: (query: string) => currentCache().get(normalized(query)),
    session(result: DictionaryResult) { dom.window.sessionStorage.setItem(`${SESSION}:${owner}`, JSON.stringify({ owner, historyVersion: 1, query: result.query, result, cache: {} })); },
    owner(next: string) { owner = next; },
    fetch(next: typeof handleFetch) { handleFetch = next; },
    async dispose() { cleanup(); dom.window.close(); },
  };
}

test("saved detail has the dictionary actions, uses newer cache, and opens related words only on click", async () => {
  const h = await harness(); const old = fixture(), current = fixture("当前完整释义"); const related: string[] = [];
  try {
    h.seed(current); const ui = h.render(<h.Component detailResult={old} onRelatedLookup={query => related.push(query)} preload={false} />);
    await h.waitFor(() => assert.ok(ui.getByText("当前完整释义")));
    assert.equal(ui.queryByRole("combobox"), null, "details reuse result presentation without unrelated search/history chrome");
    assert.ok(ui.getByRole("button", { name: "重新生成当前词条" }));
    for (const section of ["动词变形", "常见搭配", "近义词差别", "词族", "记忆提示"]) assert.ok(ui.getByText(section));
    await h.user.click(ui.getByRole("button", { name: "查询近义词 keep" }));
    await h.user.click(ui.getByRole("button", { name: "查询词族 retention" }));
    assert.deepEqual(related, ["keep", "retention"]); assert.equal(h.calls.length, 0);
  } finally { await h.dispose(); }
});

test("an open standalone view and study detail both reflect regeneration and subsequent cloud cache events", async () => {
  const h = await harness(); const old = fixture();
  try {
    h.seed(old); h.session(old);
    h.fetch(async (url, init) => { assert.equal(url, "/api/dictionary-stream"); assert.equal(JSON.parse(String(init?.body)).query, "retain"); return new Response(streamBody(fixture("重新生成的释义"))); });
    const ui = h.render(<><div data-testid="standalone"><h.Component /></div><div data-testid="detail"><h.Component detailResult={old} /></div></>);
    await h.waitFor(() => assert.equal(ui.getAllByText("旧释义").length, 2));
    await h.user.click(h.within(ui.getByTestId("detail")).getByRole("button", { name: "重新生成当前词条" }));
    await h.waitFor(() => assert.equal(ui.getAllByText("重新生成的释义").length, 2));
    assert.equal(h.calls.length, 1); assert.equal(h.read("retain")?.result.senses[0].meaning, "重新生成的释义");
    await h.act(async () => { h.seed(fixture("另一设备的新释义"), "2099-01-01T00:00:00.000Z"); h.emit(MERGED); });
    await h.waitFor(() => assert.equal(ui.getAllByText("另一设备的新释义").length, 2));
    assert.equal(h.calls.length, 1, "cache events never regenerate");
  } finally { await h.dispose(); }
});

test("restoring an old session takes the newer saved result without any generation", async () => {
  const h = await harness();
  try {
    h.session(fixture("旧会话释义")); h.seed(fixture("已同步的新释义"));
    const ui = h.render(<h.Component />);
    await h.waitFor(() => assert.ok(ui.getByText("已同步的新释义")));
    assert.equal(ui.queryByText("旧会话释义"), null); assert.equal(h.calls.length, 0);
  } finally { await h.dispose(); }
});

test("a saved detail without a local cache stays read-only until the user explicitly regenerates", async () => {
  const h = await harness();
  try {
    const ui = h.render(<h.Component detailResult={fixture()} />);
    await h.waitFor(() => assert.ok(ui.getByText("旧释义")));
    await h.act(async () => { h.emit(MERGED); });
    assert.equal(h.calls.length, 0); assert.equal(h.read("retain"), undefined);
  } finally { await h.dispose(); }
});

test("a newer vocabulary detail survives an older partially synchronized cache", async () => {
  const h = await harness();
  try {
    h.seed(fixture("较旧的查询缓存"), "2000-01-01T00:00:00.000Z");
    const ui = h.render(<h.Component detailResult={fixture("较新的生词详情")} detailUpdatedAt="2001-01-01T00:00:00.000Z" />);
    await h.waitFor(() => assert.ok(ui.getByText("较新的生词详情")));
    await h.act(async () => { h.emit(MERGED); });
    assert.ok(ui.getByText("较新的生词详情")); assert.equal(ui.queryByText("较旧的查询缓存"), null);
    assert.equal(h.calls.length, 0);
  } finally { await h.dispose(); }
});

test("a saved server winner replaces progressive candidate text and preserves its authoritative timestamp", async () => {
  const h = await harness(); const old = fixture(); const winner = fixture("并发写入的最终词条");
  const serverAt = "2001-01-01T00:00:00.000Z";
  try {
    h.seed(old); h.fetch(async () => new Response(streamBody(fixture("已被替代的生成候选")) + JSON.stringify({
      type: "savedDictionary", snapshot: { schemaVersion: 2, query: "retain", normalizedQuery: "retain", result: winner, updatedAt: serverAt },
    }) + "\n"));
    const ui = h.render(<h.Component detailResult={old} />);
    await h.waitFor(() => assert.ok(ui.getByText("旧释义")));
    await h.user.click(ui.getByRole("button", { name: "重新生成当前词条" }));
    await h.waitFor(() => assert.ok(ui.getByText("并发写入的最终词条")));
    assert.equal(ui.queryByText("已被替代的生成候选"), null);
    assert.equal(h.read("retain")?.updatedAt, serverAt, "replaying a server snapshot must not re-date it to client now");
    assert.equal(h.calls.length, 1);
  } finally { await h.dispose(); }
});

test("failed regeneration restores a newer detail rather than its older partial-sync cache", async () => {
  const h = await harness();
  try {
    h.seed(fixture("较旧的查询缓存"), "2000-01-01T00:00:00.000Z");
    h.fetch(async () => Response.json({ error: "失败" }, { status: 503 }));
    const ui = h.render(<h.Component detailResult={fixture("较新的生词详情")} detailUpdatedAt="2001-01-01T00:00:00.000Z" />);
    await h.waitFor(() => assert.ok(ui.getByText("较新的生词详情")));
    await h.user.click(ui.getByRole("button", { name: "重新生成当前词条" }));
    await h.waitFor(() => assert.ok(ui.getByRole("alert")));
    assert.ok(ui.getByText("较新的生词详情")); assert.equal(ui.queryByText("较旧的查询缓存"), null);
  } finally { await h.dispose(); }
});

test("a late read-only recovery response cannot replace a newer cache received while it was loading", async () => {
  const h = await harness(); let finish!: (response: Response) => void;
  try {
    h.fetch(async url => { assert.ok(url.includes("dictionary-history")); return new Promise(resolve => { finish = resolve; }); });
    const ui = h.render(<h.Component initialQuery="retain" />);
    await h.waitFor(() => assert.equal(h.calls.length, 1));
    await h.act(async () => { h.seed(fixture("加载期间收到的新结果"), "2001-01-01T00:00:00.000Z"); h.emit(MERGED); });
    await h.act(async () => { finish(Response.json({ dictionary: fixture("稍后返回的旧结果"), updatedAt: "2000-01-01T00:00:00.000Z" })); });
    await h.waitFor(() => assert.ok(ui.getByText("加载期间收到的新结果")));
    assert.equal(ui.queryByText("稍后返回的旧结果"), null); assert.equal(h.calls.length, 1);
    assert.equal(h.read("retain")?.updatedAt, "2001-01-01T00:00:00.000Z");
  } finally { await h.dispose(); }
});

for (const mode of ["http", "partial", "network"] as const) {
  test(`${mode} regeneration failure keeps the previous complete detail and durable cache`, async () => {
    const h = await harness(); const old = fixture();
    try {
      h.seed(old); h.fetch(async () => {
        if (mode === "http") return Response.json({ error: "失败" }, { status: 503 });
        if (mode === "network") throw new TypeError("network unavailable");
        return new Response(streamBody(fixture("尚未完整的新结果"), false));
      });
      const ui = h.render(<h.Component detailResult={old} />);
      await h.waitFor(() => assert.ok(ui.getByText("旧释义")));
      await h.user.click(ui.getByRole("button", { name: "重新生成当前词条" }));
      await h.waitFor(() => assert.ok(ui.getByRole("alert")));
      assert.ok(ui.getByText("旧释义")); assert.equal(ui.queryByText("尚未完整的新结果"), null);
      assert.equal(h.read("retain")?.result.senses[0].meaning, "旧释义"); assert.equal(h.calls.length, 1);
    } finally { await h.dispose(); }
  });
}

test("closing a detail aborts regeneration and cannot replace its saved result", async () => {
  const h = await harness(); const old = fixture(); let finish!: (response: Response) => void;
  try {
    h.seed(old); h.fetch(() => new Promise(resolve => { finish = resolve; }));
    const ui = h.render(<h.Component detailResult={old} />);
    await h.waitFor(() => assert.ok(ui.getByText("旧释义")));
    await h.user.click(ui.getByRole("button", { name: "重新生成当前词条" }));
    await h.waitFor(() => assert.equal(h.calls.length, 1)); ui.unmount();
    assert.ok(h.calls[0].init?.signal?.aborted);
    await h.act(async () => { finish(new Response(streamBody(fixture("关闭后迟到的结果")))); });
    assert.equal(h.read("retain")?.result.senses[0].meaning, "旧释义");
  } finally { await h.dispose(); }
});

test("an explicit related-word opening uses saved cache and a new query generates only once", async () => {
  const h = await harness();
  try {
    h.seed(fixture("近义词已有结果", "keep"));
    let ui = h.render(<h.Component initialQuery="keep" />);
    await h.waitFor(() => assert.ok(ui.getByText("近义词已有结果"))); assert.equal(h.calls.length, 0);
    ui.unmount();
    h.fetch(async (url, init) => url.includes("dictionary-history") ? Response.json({ dictionary: null }, { status: 404 })
      : new Response(streamBody(fixture("新相关词的结果", JSON.parse(String(init?.body)).query))));
    ui = h.render(<h.Component initialQuery="retention" />);
    await h.waitFor(() => assert.ok(ui.getByText("新相关词的结果")));
    ui.rerender(<h.Component initialQuery="retention" />);
    await h.act(async () => {});
    assert.equal(h.calls.filter(call => call.url === "/api/dictionary-stream").length, 1);
  } finally { await h.dispose(); }
});

test("account switching aborts in-flight regeneration and isolates displayed and saved results", async () => {
  const h = await harness(); const old = fixture("A 的结果"); let finish!: (response: Response) => void;
  try {
    h.seed(old); h.fetch(() => new Promise(resolve => { finish = resolve; }));
    const ui = h.render(<h.Component detailResult={old} />);
    await h.waitFor(() => assert.ok(ui.getByText("A 的结果")));
    await h.user.click(ui.getByRole("button", { name: "重新生成当前词条" }));
    await h.waitFor(() => assert.equal(h.calls.length, 1));
    h.owner("account-b"); const next = fixture("B 的结果"); h.seed(next);
    ui.rerender(<h.Component detailResult={next} />);
    await h.waitFor(() => assert.ok(ui.getByText("B 的结果")));
    assert.ok(h.calls[0].init?.signal?.aborted);
    await h.act(async () => { finish(new Response(streamBody(fixture("A 迟到的结果")))); });
    assert.ok(ui.getByText("B 的结果")); assert.equal(ui.queryByText("A 迟到的结果"), null);
    assert.equal(h.read("retain")?.result.senses[0].meaning, "B 的结果");
    h.owner("account-a"); assert.equal(h.read("retain")?.result.senses[0].meaning, "A 的结果");
  } finally { await h.dispose(); }
});
