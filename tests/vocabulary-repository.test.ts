import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import LZString from "lz-string";
import { getLearningStorage, initializeLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { getVocabularyEntries, saveVocabularyEntries, normalizeVocabularyEntries, replaceMatchingVocabularyEntry, deleteVocabularyEntry } from "../lib/vocabulary";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_SYNC_TOMBSTONES_KEY } from "../lib/accountEvents";

const KEY = "context-reader:vocabulary:v1";
const OWNER = "context-reader:local-account-owner:v1";
const at = "2026-10-01T00:00:00.000Z";
const fixture = (id = "original", word = "resilient") => ({
  id, word, lemma: word, sourceSentence: "The resilient team kept learning.",
  contextMeaning: "坚韧的", basicMeaning: "有韧性的", createdAt: at, updatedAt: at,
  sourceArticle: { kind: "public", id: "article-1", title: "Learning" },
  anki: { ankiNoteId: 1234, ankiImportedAt: at, cardMode: "cloze_context" },
});

async function device() {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  const select = () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.window.CustomEvent });
  };
  select();
  await initializeLearningStorage();
  const storage = getLearningStorage();
  return { dom, storage, select, close() { if (isLearningStorage(storage)) storage.close(); dom.window.close(); } };
}

test("legacy compressed duplicates migrate once, retaining canonical id, backup, imported note and tombstone", async () => {
  const d = await device();
  try {
    const entries = [fixture(), { ...fixture("original-local-recovered-copy"), contextMeaning: "新释义", updatedAt: "2026-10-02T00:00:00.000Z" }];
    const raw = "lz-utf16:" + LZString.compressToUTF16(JSON.stringify(entries));
    d.storage.setItem(KEY, raw);
    const storedRaw = d.storage.getItem(KEY);
    let notifications = 0;
    d.dom.window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, () => notifications++);
    const first = getVocabularyEntries();
    assert.equal(first.length, 1);
    assert.equal(first[0].id, "original");
    assert.equal(first[0].contextMeaning, "新释义");
    assert.equal(first[0].createdAt, at);
    assert.equal(first[0].anki.ankiNoteId, 1234);
    assert.equal(d.storage.getItem("context-reader:vocabulary-backup-before-dedupe:v1"), storedRaw);
    assert.ok(JSON.parse(d.storage.getItem(ACCOUNT_SYNC_TOMBSTONES_KEY)!)["vocabulary:original-local-recovered-copy"]);
    const count = notifications;
    assert.deepEqual(getVocabularyEntries(), first);
    assert.equal(notifications, count, "replay must not emit writes or tombstones");
  } finally { d.close(); }
});

test("legacy Storage keeps compressed encoding and cached reads preserve its full result", async () => {
  const d = await device();
  try {
    Object.defineProperty(d.dom.window, "__contextPreviewStorage", { value: d.dom.window.localStorage });
    d.dom.window.localStorage.setItem(KEY, JSON.stringify([fixture()]));
    const expected = getVocabularyEntries();
    assert.ok(d.dom.window.localStorage.getItem(KEY)!.startsWith("lz-utf16:"));
    assert.deepEqual(getVocabularyEntries(), expected);
    d.dom.window.localStorage.setItem(KEY, "lz-utf16:" + LZString.compressToUTF16(JSON.stringify([fixture("new")] )));
    assert.equal(getVocabularyEntries()[0].id, "new");
  } finally { d.close(); }
});

test("synchronous synchronization during migration cannot poison the next read", async () => {
  const d = await device();
  try {
    d.storage.setItem(KEY, JSON.stringify([fixture("old")]));
    d.dom.window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, () => {
      d.storage.setItem(KEY, JSON.stringify([fixture("new-from-sync")]));
    }, { once: true });
    assert.equal(getVocabularyEntries()[0].id, "old");
    assert.equal(getVocabularyEntries()[0].id, "new-from-sync");
  } finally { d.close(); }
});

test("repeated reads avoid decoding and never expose a mutable repository snapshot", async () => {
  const d = await device();
  try {
    saveVocabularyEntries(normalizeVocabularyEntries([fixture()]));
    const first = getVocabularyEntries();
    const originalParse = JSON.parse;
    let decoded = 0;
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => { decoded++; return originalParse(...args); };
    let second;
    try { second = getVocabularyEntries(); } finally { JSON.parse = originalParse; }
    assert.equal(decoded, 0);
    assert.deepEqual(second, first);
    first[0].word = "mutated";
    first[0].anki.ankiNoteId = 999;
    first[0].sourceArticle!.title = "mutated";
    second!.splice(0);
    const next = getVocabularyEntries();
    assert.equal(next[0].word, "resilient");
    assert.equal(next[0].anki.ankiNoteId, 1234);
    assert.equal(next[0].sourceArticle!.title, "Learning");
  } finally { d.close(); }
});

test("raw sync writes, account changes, deletion, corrupt bytes and recovery invalidate snapshots", async () => {
  const d = await device();
  try {
    d.storage.setItem(OWNER, "A");
    saveVocabularyEntries(normalizeVocabularyEntries([fixture()]));
    getVocabularyEntries();
    d.storage.setItem(OWNER, "B");
    d.storage.setItem(KEY, JSON.stringify([fixture("cloud", "flourish")]));
    assert.equal(getVocabularyEntries()[0].id, "cloud");
    d.storage.removeItem(KEY);
    assert.deepEqual(getVocabularyEntries(), []);
    d.storage.setItem(KEY, "invalid-json");
    assert.deepEqual(getVocabularyEntries(), []);
    d.storage.setItem(KEY, JSON.stringify([fixture("restored")]));
    assert.equal(getVocabularyEntries()[0].id, "restored");
  } finally { d.close(); }
});

test("independent storage instances cannot return another device's cached entries", async () => {
  const a = await device();
  saveVocabularyEntries(normalizeVocabularyEntries([fixture("device-a")]));
  getVocabularyEntries();
  const b = await device();
  try {
    assert.deepEqual(getVocabularyEntries(), []);
    saveVocabularyEntries(normalizeVocabularyEntries([fixture("device-b")]));
    assert.equal(getVocabularyEntries()[0].id, "device-b");
    a.select();
    assert.equal(getVocabularyEntries()[0].id, "device-a");
    b.select();
    assert.equal(getVocabularyEntries()[0].id, "device-b");
  } finally { a.close(); b.close(); }
});

test("regeneration and deletion preserve domain identity and historical Anki compatibility", async () => {
  const d = await device();
  try {
    saveVocabularyEntries(normalizeVocabularyEntries([fixture()]));
    const original = getVocabularyEntries()[0];
    replaceMatchingVocabularyEntry({ ...original, contextMeaning: "重新解释" }, {
      word: original.word, sentence: original.sourceSentence, previousSentence: "", nextSentence: "", paragraphIndex: 0, tokenIndex: 0,
    });
    const changed = getVocabularyEntries()[0];
    assert.equal(changed.id, original.id);
    assert.equal(changed.createdAt, original.createdAt);
    assert.equal(changed.anki.ankiNoteId, original.anki.ankiNoteId);
    assert.equal(changed.contextMeaning, "重新解释");
    deleteVocabularyEntry(changed.id);
    assert.deepEqual(getVocabularyEntries(), []);
    assert.ok(JSON.parse(d.storage.getItem(ACCOUNT_SYNC_TOMBSTONES_KEY)!)["vocabulary:original"]);
  } finally { d.close(); }
});
