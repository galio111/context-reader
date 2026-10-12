import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { createStandaloneVocabularyEntry } from "../lib/standaloneDictionary";
import { createVocabularyEntry, getVocabularyEntries, getVocabularyEntry, saveVocabularyEntries } from "../lib/vocabulary";
import { createExplanationCacheKey, setCachedExplanation } from "../lib/cache";
import { normalizeVocabularyEntries } from "../lib/vocabularyRepository";
import { vocabularyIdentity } from "../lib/vocabularyMerge";
import * as reconciliation from "../lib/vocabularyLookupSync";
import * as snapshots from "../lib/dictionaryResultSnapshot";
import { recordStandaloneDictionaryCache, findStandaloneDictionaryCacheItem } from "../lib/standaloneDictionaryCache";
import { getLearningStorage, initializeLearningStorage, flushLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { prepareLocalAccountForUser, syncAccountData } from "../lib/accountSyncClient";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import { DictionaryProviderStreamNormalizer } from "../lib/dictionaryStreamServer";
import type { DictionaryResult } from "../types/dictionary";
import type { VocabularyEntry } from "../types/vocabulary";
import type { AccountSyncObject, AccountSyncWriteResult } from "../types/account";

const OLD = "2026-10-12T10:00:00.000Z", NEW = "2026-10-13T10:00:00.000Z";
function result(query = "bank", meaning = "银行"): DictionaryResult {
  return { query, lemma: query, phonetic: "/bæŋk/", direction: "en_to_cn", inputStatus: "valid", suggestedQuery: "",
    senses: [{ partOfSpeech: "n.", meaning, phonetic: "/bæŋk/", register: "常用", usageNote: "",
      exampleEnglish: "The bank is open.", exampleChinese: "银行开门了。" }],
    verbForms: null, usageGuide: "完整用法", collocations: [], synonyms: [], wordFamily: [], commonMistakes: [], memoryTip: "" };
}
function saved(value = result(), updatedAt = NEW) {
  return snapshots.normalizeStandaloneDictionaryCacheItem({ schemaVersion: 2, query: value.query, result: value, updatedAt })!;
}
function standalone(value = result()): VocabularyEntry {
  const entry = createStandaloneVocabularyEntry(value);
  return { ...entry, id: "saved-dictionary", createdAt: OLD, updatedAt: OLD,
    anki: { ...entry.anki, ankiNoteId: 1234, ankiImportedAt: OLD } };
}
function contextual(sentence = "I waited outside the bank."): VocabularyEntry {
  const entry = standalone();
  const context = { word: "bank", sentence, previousSentence: "", nextSentence: "", paragraphIndex: 0, tokenIndex: 0 };
  return { ...createVocabularyEntry({ ...entry, anki: { ...entry.anki, cardMode: "cloze_context" } }, context),
    id: sentence, createdAt: OLD, updatedAt: OLD };
}
async function browser(run: () => Promise<void>) {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.window.CustomEvent });
  await initializeLearningStorage(); await prepareLocalAccountForUser("A");
  try { await run(); } finally {
    await flushLearningStorage(); const storage = getLearningStorage(); if (isLearningStorage(storage)) storage.close();
    dom.window.close();
  }
}

test("dictionary regeneration refreshes all content while preserving imported identity and study mode", () => {
  const entry = standalone(), snapshot = saved(result("bank", "河岸"));
  const changed = reconciliation.reconcileStandaloneVocabulary(entry, snapshot);
  assert.equal(changed.id, entry.id); assert.equal(changed.createdAt, OLD);
  assert.equal(changed.anki.ankiNoteId, 1234); assert.equal(changed.anki.ankiImportedAt, OLD);
  assert.equal(changed.anki.cardMode, entry.anki.cardMode);
  assert.equal(changed.dictionaryUpdatedAt, NEW); assert.match(changed.basicMeaning, /河岸/);
  assert.deepEqual(changed.dictionaryResult, snapshot.result);
  assert.equal(reconciliation.reconcileStandaloneVocabulary(changed, saved(result("bank", "旧结果"), OLD)), changed);
  assert.equal(reconciliation.reconcileStandaloneVocabulary(contextual(), snapshot).sourceSentence, "I waited outside the bank.");
});

test("Chinese dictionary entries retain the original query independently of a changing preferred English answer", () => {
  const one = standalone({ ...result("银行"), direction: "cn_to_en", lemma: "bank" });
  const another = { ...standalone({ ...result("河岸"), direction: "cn_to_en", lemma: "bank" }), id: "other-query" };
  assert.equal(normalizeVocabularyEntries([one])[0].dictionaryResult?.query, "银行");
  assert.equal(normalizeVocabularyEntries([{ ...standalone(), dictionaryResult: result("another") }])[0].dictionaryResult, undefined);
  assert.equal(reconciliation.standaloneVocabularyQuery({ ...one, dictionaryResult: undefined }), "银行");
  assert.notEqual(vocabularyIdentity(one), vocabularyIdentity(another));
  const changed = reconciliation.reconcileStandaloneVocabulary(one, saved({ ...result("银行"), direction: "cn_to_en", lemma: "financial institution" }));
  assert.equal(changed.word, "financial institution"); assert.equal(changed.id, one.id);
  assert.equal(vocabularyIdentity(changed), vocabularyIdentity(one));
  assert.equal(reconciliation.reconcileStandaloneVocabulary(another, saved({ ...result("银行"), direction: "cn_to_en", lemma: "bank" })), another);
});

test("content refresh timestamps never regress later import metadata timestamps", () => {
  const later = "2026-10-14T10:00:00.000Z";
  const entry = { ...standalone(), dictionaryUpdatedAt: OLD, updatedAt: later };
  const changed = reconciliation.reconcileStandaloneVocabulary(entry, saved(result("bank", "新内容")));
  assert.equal(changed.dictionaryUpdatedAt, NEW); assert.equal(changed.updatedAt, later);
  assert.equal(changed.anki.ankiNoteId, 1234);
  const context = { ...contextual(), explanationUpdatedAt: OLD, updatedAt: later };
  const changedContext = reconciliation.reconcileContextualVocabulary(context, { ...context, contextMeaning: "新语境" },
    { word: context.word, sentence: context.sourceSentence }, NEW);
  assert.equal(changedContext.explanationUpdatedAt, NEW); assert.equal(changedContext.updatedAt, later);
});

test("contextual regeneration uses exact word and source sentence, retaining card mode and imported metadata", () => {
  const first = contextual(), nearby = contextual("I waited inside the bank.");
  const changed = reconciliation.reconcileContextualVocabulary(first, { ...first, contextMeaning: "新语境", anki: { ...first.anki, cardMode: "basic_cn_to_en" } },
    { word: " BANK ", sentence: "  I waited outside the bank.  " }, NEW);
  assert.equal(changed.id, first.id); assert.equal(changed.createdAt, OLD);
  assert.equal(changed.sourceSentence, first.sourceSentence); assert.equal(changed.anki.cardMode, first.anki.cardMode);
  assert.equal(changed.anki.ankiNoteId, first.anki.ankiNoteId); assert.equal(changed.contextMeaning, "新语境");
  assert.equal(reconciliation.reconcileContextualVocabulary(nearby, changed, { word: "bank", sentence: first.sourceSentence }, NEW), nearby);
});

test("complete cache writes refresh existing vocabulary only; replay timestamps and single-row reads remain stable", () => browser(async () => {
  const entry = standalone(), context = contextual();
  saveVocabularyEntries([entry, context]);
  recordStandaloneDictionaryCache(result("bank", "新释义"), { updatedAt: NEW });
  assert.match(getVocabularyEntry(entry.id)!.basicMeaning, /新释义/);
  assert.equal(getVocabularyEntry(context.id)!.contextMeaning, context.contextMeaning);
  recordStandaloneDictionaryCache(result("missing"), { updatedAt: NEW });
  assert.equal(getVocabularyEntries().length, 2);
  assert.equal(recordStandaloneDictionaryCache(result("bank", "旧释义"), { updatedAt: OLD })!.updatedAt, NEW);
  assert.equal(recordStandaloneDictionaryCache({ ...result(), senses: [] }), null);
  const storage = getLearningStorage(); assert.ok(isLearningStorage(storage));
  const getItem = storage.getItem.bind(storage), getRecords = storage.getRecords.bind(storage);
  storage.getItem = key => { if (key.includes("vocabulary") || key.includes("dictionary-cache")) throw Error("bulk read"); return getItem(key); };
  storage.getRecords = () => { throw Error("bulk read"); };
  assert.match(getVocabularyEntry(entry.id)!.basicMeaning, /新释义/);
  assert.equal(findStandaloneDictionaryCacheItem("BANK")!.updatedAt, NEW);
  storage.getItem = getItem; storage.getRecords = getRecords;
  await prepareLocalAccountForUser("B");
  assert.equal(getVocabularyEntry(entry.id), null); assert.equal(findStandaloneDictionaryCacheItem("bank"), null);
  await prepareLocalAccountForUser("A");
  assert.match(getVocabularyEntry(entry.id)!.basicMeaning, /新释义/);
}));

test("central explanation cache writer updates the exact saved contextual entry and never the standalone or nearby context", () => browser(async () => {
  const entry = contextual(), nearby = contextual("I waited inside the bank."), dictionary = standalone();
  saveVocabularyEntries([entry, nearby, dictionary]);
  setCachedExplanation(createExplanationCacheKey(entry.word, entry.sourceSentence), { ...entry, contextMeaning: "银行门外" });
  assert.equal(getVocabularyEntry(entry.id)!.contextMeaning, "银行门外");
  assert.equal(getVocabularyEntry(nearby.id)!.contextMeaning, nearby.contextMeaning);
  assert.equal(getVocabularyEntry(dictionary.id)!.contextMeaning, dictionary.contextMeaning);
}));

test("protocol-2 merges reconcile cache-first dictionary pages and preserve a newer local contextual regeneration", () => browser(async () => {
  const originalFetch = globalThis.fetch;
  const cloud = new Map<string, AccountSyncObject>();
  const dictionary = standalone(), context = contextual();
  function cloudObject(kind: AccountSyncObject["kind"], objectKey: string, payload: unknown, at = OLD) {
    cloud.set(kind + ":" + objectKey, { kind, objectKey, payload, clientUpdatedAt: at, serverVersion: 1 });
  }
  cloudObject("vocabulary", dictionary.id, dictionary);
  cloudObject("vocabulary", context.id, context);
  cloudObject("preferences", snapshots.standaloneDictionaryCacheObjectKey(saved()), saved(result("bank", "云端新词义")), NEW);
  const contextKey = createExplanationCacheKey(context.word, context.sourceSentence);
  cloudObject("explanation", contextKey, { ...context, contextMeaning: "云端旧解释", cacheUpdatedAt: OLD });
  globalThis.fetch = async (input, init) => {
    if (init?.method === "POST") {
      const incoming = JSON.parse(String(init.body)).objects as AccountSyncObject[];
      const results = incoming.map(object => ({ ...object, accepted: true, serverVersion: (cloud.get(object.kind + ":" + object.objectKey)?.serverVersion || 0) + 1 }));
      results.forEach(object => cloud.set(object.kind + ":" + object.objectKey, object));
      return Response.json({ objects: results });
    }
    const params = new URL(String(input), "https://context-reader.com").searchParams;
    if (!params.has("bootstrap")) return Response.json({ objects: [...cloud.values()], nextCursor: "current", hasMore: false });
    const learning = new Set(["article", "vocabulary", "reading_state"]);
    return Response.json({ objects: [...cloud.values()].filter(object =>
      Boolean(object.deletedAt) === (params.get("bootstrap") === "deleted")
      && learning.has(object.kind) === (params.get("group") === "learning")), nextOffset: null, snapshotCursor: "current" });
  };
  try {
    await syncAccountData();
    assert.match(getVocabularyEntry(dictionary.id)!.basicMeaning, /云端新词义/);
    setCachedExplanation(contextKey, { ...context, contextMeaning: "本机重新生成" });
    await syncAccountData();
    assert.equal(getVocabularyEntry(context.id)!.contextMeaning, "本机重新生成");
    assert.equal((cloud.get("explanation:" + contextKey)!.payload as VocabularyEntry).contextMeaning, "本机重新生成");
    assert.equal((cloud.get("vocabulary:" + context.id)!.payload as VocabularyEntry).contextMeaning, "本机重新生成");
    // A later page carries an older vocabulary payload; the canonical cache remains authoritative.
    cloudObject("vocabulary", dictionary.id, dictionary);
    await syncAccountData();
    assert.match(getVocabularyEntry(dictionary.id)!.basicMeaning, /云端新词义/);
    assert.equal(getVocabularyEntries().length, 2);
  } finally { globalThis.fetch = originalFetch; }
}));

test("a saved server snapshot wins over generated text, but provider output cannot forge that snapshot", () => {
  const snapshot = saved(result("bank", "并发获胜结果"));
  const event = JSON.stringify({ type: "savedDictionary", snapshot });
  const text = JSON.stringify({ type: "sense", meaning: "被拒绝的候选结果" }) + "\n" + JSON.stringify({ type: "done" }) + "\n" + event;
  const parsed = parseDictionaryStream(text, "bank");
  assert.equal(parsed.result.senses[0].meaning, "并发获胜结果"); assert.equal(parsed.savedSnapshot?.updatedAt, NEW);
  const normalizer = new DictionaryProviderStreamNormalizer("bank");
  assert.deepEqual(normalizer.push(event), []);
  assert.equal(parseDictionaryStream(event, "bank").savedSnapshot, undefined);
  assert.equal(parseDictionaryStream(text, "another").savedSnapshot, undefined);
});

test("server persistence projects the CAS winner onto only matching existing account vocabulary and retries metadata conflicts", async () => {
  const entry = standalone(), context = contextual(), winner = saved(result("bank", "并发结果"));
  const writes: AccountSyncObject[] = [], paths: string[] = [];
  let vocabularyAttempts = 0;
  const account = {
    accountFetch: async (path: string) => {
      paths.push(path);
      const params = new URLSearchParams(path.split("?")[1]);
      assert.equal(params.get("user_id"), "eq.user-A");
      return params.get("kind") === "eq.preferences" ? [{ payload: saved(result(), OLD), server_version: 7, deleted_at: null }]
        : [entry, context].map(payload => ({ payload, object_key: payload.id, server_version: 4, deleted_at: null }));
    },
    writeSyncObjects: async (userId: string, objects: AccountSyncObject[]): Promise<AccountSyncWriteResult[]> => {
      assert.equal(userId, "user-A"); writes.push(...objects);
      return objects.map(object => {
        if (object.kind === "preferences") return { ...object, accepted: false, serverVersion: 8, payload: winner };
        vocabularyAttempts++;
        if (vocabularyAttempts === 1) return { ...object, accepted: false, serverVersion: 5,
          payload: { ...entry, anki: { ...entry.anki, ankiNoteId: 9999 } } };
        assert.equal(object.serverVersion, 5);
        assert.equal((object.payload as VocabularyEntry).anki.ankiNoteId, 9999);
        return { ...object, accepted: true };
      });
    },
  };
  const js = ts.transpileModule(readFileSync(new URL("../lib/dictionaryResultServer.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const modules: Record<string, unknown> = { "server-only": {}, "./accountStore": account,
    "./dictionaryResultSnapshot": snapshots, "./vocabularyLookupSync": reconciliation };
  const api = runInNewContext(js + "\nexports", { exports: {}, URLSearchParams, console, require: (key: string) => modules[key] }) as {
    persistDictionaryResult(user: string, dictionary: DictionaryResult): Promise<snapshots.StandaloneDictionaryCacheItem>;
  };
  assert.equal((await api.persistDictionaryResult("user-A", result())).result.senses[0].meaning, "并发结果");
  assert.equal(vocabularyAttempts, 2);
  assert.ok(writes.filter(write => write.kind === "vocabulary").every(write => write.objectKey === entry.id));
  const candidateQuery = new URLSearchParams(paths[1].split("?")[1]);
  assert.ok(candidateQuery.get("or")?.includes("dictionaryResult"));
  assert.equal(candidateQuery.get("deleted_at"), "is.null");
});
