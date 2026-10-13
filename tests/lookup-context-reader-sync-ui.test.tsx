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
import type { VocabularyEntry } from "../types/vocabulary";
import type { WordContext, WordExplanation } from "../types/reader";

const sourceRoot = process.env.SOURCE_WORKTREE || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(resolve(sourceRoot, "package.json"));
const sourceContext: WordContext = { word: "bank", sentence: "She waited outside the bank.", previousSentence: "", nextSentence: "", paragraphIndex: 0, tokenIndex: 4 };

function explanation(contextMeaning: string): WordExplanation {
  return { word: "bank", lemma: "bank", phonetic: "/bæŋk/", phoneticFor: "bank", partOfSpeech: "noun", basicMeaning: "银行；河岸", contextMeaning,
    sentenceTranslation: "她在银行外等候。", usageNote: "此处指金融机构。", collocation: "outside the bank", exampleEnglish: "The bank opens at nine.", exampleChinese: "银行九点开门。",
    difficulty: "medium", shouldAddToVocabulary: true,
    anki: { canMakeCloze: true, cardMode: "cloze_context", clozeSentence: "She waited outside the {{c1::bank}}.", contextCue: contextMeaning,
      basicCue: "银行", frontPreview: "She waited outside the …", backPreview: contextMeaning, ankiNoteId: null, ankiImportedAt: null } };
}

async function readerHarness() {
  const dom = new JSDOM("", { url: "https://context-reader.com", pretendToBeVisual: true });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "CustomEvent", "StorageEvent", "KeyboardEvent", "MouseEvent"])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? dom.window : key === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[key] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  dom.window.matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const storage = dom.window.localStorage;
  storage.setItem("context-reader:local-account-owner:v1", "account-reader");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let nextExplanation = explanation("生成后的精确语境释义");
  const nullComponent = () => null;
  const modules: Record<string, unknown> = {
    react: React, "next/dynamic": { default: () => nullComponent }, "lz-string": { default: nodeRequire("lz-string") },
    "@/lib/learningStorage": { getLearningStorage: () => storage, isLearningStorage: () => false, flushLearningStorage: async () => {} },
    "@/components/AccountProvider": { useAccount: () => ({ account: { authenticated: true, configured: true, profile: { userId: "account-reader" } },
      hasLocalAccountAccess: true, isOffline: false, localAccount: null, requireAccount: () => true, requireLocalAccount: () => true, openLogin() {}, refreshAccount: async () => {} }) },
    "@/components/AnkiSettingsPanel": { defaultAnkiSettings: () => ({ endpoint: "http://127.0.0.1:8765", deckName: "Context Reader" }) },
    "@/components/ArticleTranslationPanel": { ArticleTranslationPanel: nullComponent }, "@/components/BookDictionary": { BookDictionary: nullComponent },
    "@/components/HomeOptionMenu": { HomeOptionMenu: nullComponent }, "@/components/PillNavAction": { PillNavAction: nullComponent },
    "@/components/PronunciationButtons": { PronunciationButtons: nullComponent },
    "@/components/ClearableField": { default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
    "@/components/useMobileBottomSheet": { MOBILE_READER_SHEET_HEIGHT: 56, useMobileBottomSheet: () => ({ height: 56, dragOffset: 0, dragging: false }) },
    "@/components/useMobileSheetScrollBoundary": { useMobileSheetScrollBoundary: () => React.useRef(null) },
    "@/components/useDocumentScrollLock": { useDocumentScrollLock() {} },
    "@/components/cet/useCetQuestionDock": { useCetQuestionDock: () => ({ open: false, close() {}, show() {} }) },
    "@/components/ReaderTextAdapter": { ReaderTextContext: React.createContext(null) },
    "@/components/useReadingEvidence": { useReadingEvidence() {} },
    "@/components/useReaderTranslationSession": { preparedTranslationOwner: () => "account-reader", useReaderTranslationSession: () => ({ translations: [], loading: false,
      error: "", requested: false, estimatedSecondsRemaining: 0, retryAfterSeconds: 0, retryReason: "", regenerating: false,
      completedTargetBlocks: 0, totalTargetBlocks: 0, staleBlockIds: [], removedCount: 0, ready: true, showCachedTranslations() {} }) },
    "@/lib/ankiConnect": { addVocabularyNote() { throw Error("unexpected Anki write"); }, checkAnki() {}, findImportedVocabularyNoteIds() {} },
    "@/lib/articles": { findSavedArticle: () => null, isValidArticleSummary: () => false, saveArticle() {}, saveEditedArticle() {} },
    "@/lib/articleTranslationJobs": { startArticleTranslationJob() { throw Error("unexpected translation"); } },
    "@/lib/lookupCancellationClient": { notifyLookupCancellation() {} },
  };
  const loaded = new Map<string, { exports: unknown }>();
  const load = (filename: string): unknown => {
    if (loaded.has(filename)) return loaded.get(filename)!.exports;
    const module = { exports: {} as unknown }; loaded.set(filename, module);
    const localRequire = (key: string): unknown => {
      if (key in modules) return modules[key];
      if (key.endsWith(".module.css")) return { default: {} };
      if (key.startsWith("@/") || key.startsWith(".")) {
        const base = key.startsWith("@/") ? resolve(sourceRoot, key.slice(2)) : resolve(dirname(filename), key);
        const found = [base, base + ".ts", base + ".tsx", base + ".mjs"].find(path => existsSync(path));
        if (!found) throw Error("Missing module: " + key); return load(found);
      }
      return nodeRequire(key);
    };
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(output, { module, exports: module.exports, require: localRequire, React, window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, CustomEvent: dom.window.CustomEvent,
      StorageEvent: dom.window.StorageEvent, KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent,
      localStorage: storage, navigator: dom.window.navigator, CSS: { escape: (value: string) => value },
      setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), performance, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, crypto, console, process,
      ResizeObserver: class { observe() {} disconnect() {} },
      fetch: async (input: string, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        assert.equal(String(input), "/api/explain-word-stream", "only an explicit contextual lookup may issue a request");
        assert.equal(new Headers(init?.headers).get("X-Context-Account"), "account-reader");
        const display = load(resolve(sourceRoot, "lib/explanationDisplay.ts")) as { explanationAsStreamText: (value: WordExplanation) => string };
        const protocol = load(resolve(sourceRoot, "lib/explanationStreamProtocol.ts")) as { EXPLANATION_STREAM_COMPLETE_MARKER: string };
        return new Response(display.explanationAsStreamText(nextExplanation) + protocol.EXPLANATION_STREAM_COMPLETE_MARKER);
      },
    }, { filename });
    return module.exports;
  };
  const Reader = (load(resolve(sourceRoot, "components/ReaderView.tsx")) as { ReaderView: React.ComponentType<{ article: string; onBack: () => void; onArticleSaved: () => void;
    preloadedExplanations?: Array<{ cacheKey: string; explanation: WordExplanation }> }> }).ReaderView;
  const vocabulary = load(resolve(sourceRoot, "lib/vocabulary.ts")) as {
    createVocabularyEntry: (value: WordExplanation, context: WordContext) => VocabularyEntry;
    saveVocabularyEntries: (entries: VocabularyEntry[]) => void;
    getVocabularyEntry: (id: string) => VocabularyEntry | null;
  };
  const cache = load(resolve(sourceRoot, "lib/cache.ts")) as { createExplanationCacheKey: (word: string, sentence: string) => string;
    setCachedExplanation: (key: string, value: WordExplanation, options?: { updatedAt?: string; syncVocabulary?: boolean }) => void };
  const { render, cleanup, waitFor, act, fireEvent } = await import("@testing-library/react");
  return { Reader, vocabulary, cache, render, waitFor, act, fireEvent, calls,
    next(value: WordExplanation) { nextExplanation = value; },
    async dispose() { cleanup(); dom.window.close(); },
  };
}

test("real Reader regeneration updates only the saved exact context, preserves Anki identity, and receives live cache changes", async () => {
  const h = await readerHarness();
  try {
    const old = explanation("旧语境释义");
    const entry = { ...h.vocabulary.createVocabularyEntry(old, sourceContext), id: "studied-bank", createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" };
    entry.anki.ankiNoteId = 4321; entry.anki.ankiImportedAt = "2000-01-02T00:00:00.000Z";
    const other = { ...h.vocabulary.createVocabularyEntry(explanation("另一句的释义"), { ...sourceContext, sentence: "She waited beside the bank." }), id: "other-bank" };
    h.vocabulary.saveVocabularyEntries([entry, other]);
    const key = h.cache.createExplanationCacheKey(sourceContext.word, sourceContext.sentence);
    h.cache.setCachedExplanation(key, old, { updatedAt: "2000-01-01T00:00:00.000Z", syncVocabulary: false });
    const ui = h.render(<h.Reader article={sourceContext.sentence} onBack={() => {}} onArticleSaved={() => {}} />);
    await h.waitFor(() => assert.ok(ui.getByRole("button", { name: "bank" })));
    h.fireEvent.click(ui.getByRole("button", { name: "bank" }));
    await h.waitFor(() => assert.ok(ui.getAllByText("旧语境释义").length));
    assert.equal(h.calls.length, 0, "reopening the selected context uses cache");
    const regenerate = ui.getAllByRole("button", { name: /重新生成/ })[0];
    h.fireEvent.click(regenerate);
    await h.waitFor(() => assert.equal(h.vocabulary.getVocabularyEntry(entry.id)?.contextMeaning, "生成后的精确语境释义"));
    await h.waitFor(() => assert.ok(ui.getAllByText("生成后的精确语境释义").length));
    const updated = h.vocabulary.getVocabularyEntry(entry.id)!;
    assert.equal(updated.id, entry.id); assert.equal(updated.createdAt, entry.createdAt);
    assert.equal(updated.anki.ankiNoteId, 4321); assert.equal(updated.anki.ankiImportedAt, entry.anki.ankiImportedAt);
    assert.equal(updated.anki.cardMode, entry.anki.cardMode);
    assert.equal(h.vocabulary.getVocabularyEntry(other.id)?.contextMeaning, "另一句的释义", "similar sentences must not be overwritten");
    assert.equal(h.calls.length, 1, "content regeneration does not call study scheduling or Anki APIs");
    assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), { word: "bank", sentence: sourceContext.sentence, previousSentence: "", nextSentence: "" });

    await h.act(async () => { h.cache.setCachedExplanation(key, explanation("其他窗口更新的语境释义")); });
    await h.waitFor(() => assert.ok(ui.getAllByText("其他窗口更新的语境释义").length));
    assert.equal(h.vocabulary.getVocabularyEntry(entry.id)?.contextMeaning, "其他窗口更新的语境释义");
    assert.equal(ui.queryByText("生成后的精确语境释义"), null); assert.equal(h.calls.length, 1);
  } finally { await h.dispose(); }
});

test("a real Reader first lookup refreshes an existing saved context even without an earlier local cache", async () => {
  const h = await readerHarness();
  try {
    const entry = { ...h.vocabulary.createVocabularyEntry(explanation("导入的旧语境"), sourceContext), id: "imported-context",
      createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" };
    entry.anki.ankiNoteId = 9876; h.vocabulary.saveVocabularyEntries([entry]);
    h.next(explanation("首次查询后的新语境"));
    const ui = h.render(<h.Reader article={sourceContext.sentence} onBack={() => {}} onArticleSaved={() => {}} />);
    await h.waitFor(() => assert.ok(ui.getByRole("button", { name: "bank" })));
    h.fireEvent.click(ui.getByRole("button", { name: "bank" }));
    await h.waitFor(() => assert.ok(ui.getAllByText("首次查询后的新语境").length));
    const updated = h.vocabulary.getVocabularyEntry(entry.id)!;
    assert.equal(updated.contextMeaning, "首次查询后的新语境"); assert.equal(updated.id, entry.id);
    assert.equal(updated.anki.ankiNoteId, 9876); assert.equal(updated.createdAt, entry.createdAt);
    assert.equal(h.calls.length, 1);
  } finally { await h.dispose(); }
});

test("mounting a Reader with public preload cannot overwrite a newer saved contextual word", async () => {
  const h = await readerHarness();
  try {
    const entry = { ...h.vocabulary.createVocabularyEntry(explanation("用户后来生成的释义"), sourceContext), id: "newer-context",
      createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2001-01-01T00:00:00.000Z" };
    h.vocabulary.saveVocabularyEntries([entry]);
    const key = h.cache.createExplanationCacheKey(sourceContext.word, sourceContext.sentence);
    const ui = h.render(<h.Reader article={sourceContext.sentence} onBack={() => {}} onArticleSaved={() => {}}
      preloadedExplanations={[{ cacheKey: key, explanation: explanation("较早的公共预载释义") }]} />);
    await h.waitFor(() => assert.ok(ui.getByRole("button", { name: "bank" })));
    assert.equal(h.vocabulary.getVocabularyEntry(entry.id)?.contextMeaning, "用户后来生成的释义");
    assert.equal(h.vocabulary.getVocabularyEntry(entry.id)?.updatedAt, entry.updatedAt);
    assert.equal(h.calls.length, 0);
  } finally { await h.dispose(); }
});
