import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createReaderDocumentModel, type ReaderTokenCache } from "../lib/readerDocumentModel";
import { createSourceSentenceIndex } from "../lib/sourceMatching";
import { createTranslationCacheRepository } from "../lib/translationCacheRepository";
import { createArticleTranslationBlockCacheKey } from "../lib/articleTranslationIdentity";
import { LearningStorage } from "../lib/learningStorage";
import { createArticleTranslationProgress } from "../lib/articleTranslationProgress";
import { requestArticleTranslation } from "../lib/articleTranslationTransport";
import type { ImportedArticle, ImportedArticleBlock } from "../types/article";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "../types/reader";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

const article = (blocks: ImportedArticleBlock[]): ImportedArticle => ({ title: "Mixed article", text: "", url: "", siteName: "", blocks });
const block: ArticleTranslationBlock = { id: "one", type: "paragraph", text: "A deliberate reading session helps learning." };
const translated: ArticleTranslationItem = { id: "one", translation: "专注阅读有助于学习。" };
const ARTICLE_CACHE = "context-reader:article-translations:v1";
const BLOCK_CACHE = "context-reader:article-translation-blocks:v1";

test("Reader document preserves empty paragraphs, inline baselines, table cells, captions and source indexes", () => {
  const input = article([
    { id: "title", type: "heading", text: "A reader's world." },
    { id: "blank", type: "paragraph", text: "" },
    { id: "body", type: "paragraph", text: "Water H2O stays clear.", inline: [{ text: "Water H" }, { text: "2", baseline: "sub" }, { text: "O stays clear." }] },
    { id: "table", type: "table", table: { rows: [[{ text: "First cell", header: true }, { text: "Second cell" }], [{ text: "" }, { text: "A reader's world." }]] } },
    { id: "image", type: "image", src: "/cover.webp", alt: "A caption here.", width: 800, height: 600, ocrText: "Invisible legacy OCR", layoutWords: [{ text: "legacy", x: 1, y: 2, width: 3, height: 4, lineText: "legacy" }] },
    { id: "list", type: "list-item", text: "A final thought.", listStyle: "ordered", listLevel: 2, listOrdinal: 3 },
  ]);
  const model = createReaderDocumentModel("", input, {}, new Map());
  assert.deepEqual(model.renderableBlocks.map(b => [b.id, b.type]), input.blocks.map(b => [b.id, b.type]));
  assert.deepEqual(model.renderableBlocks[1].tokens, []);
  assert.deepEqual(model.renderableBlocks[2].tokenGroups?.map(g => g.baseline), [undefined, "sub", undefined]);
  assert.equal(model.renderableBlocks[3].tableRows?.[1][0].tokens.length, 0);
  assert.equal(model.renderableBlocks[4].tokens, undefined, "OCR remains disabled");
  assert.deepEqual(model.renderableBlocks[4].layoutWords, input.blocks[4].layoutWords);
  assert.equal(model.renderableBlocks[5].listOrdinal, 3);
  const referenceWords = model.renderableBlocks.flatMap(b => [...(b.tokens?.filter(t => t.type === "word") ?? []), ...(b.captionTokens?.filter(t => t.type === "word") ?? [])]);
  assert.deepEqual(model.wordTokens, referenceWords);
  assert.deepEqual(model.sourceSentenceIndex, createSourceSentenceIndex(referenceWords));
  assert.equal(new Set(model.wordTokens.map(t => t.id)).size, model.wordTokens.length);
  assert.deepEqual([...model.wordTokensByParagraph.keys()], [0, 2, 3, 4, 6, 7, 8]);
  for (const token of model.wordTokens) {
    assert.equal(model.tokenById.get(token.id), token);
    assert.ok(model.wordTokensByParagraph.get(token.paragraphIndex)?.includes(token));
    assert.ok(model.wordTokensBySentence.get(token.sentence.trim().replace(/\s+/g, " ").toLowerCase())?.includes(token));
  }
});

test("Reader token cache survives a 600-block metadata refresh and retains only current keys", () => {
  const cache: ReaderTokenCache = new Map();
  const input = article(Array.from({ length: 600 }, (_, i) => ({ id: `b-${i}`, type: "paragraph", text: `Reading block ${i} makes steady progress.` })));
  const before = createReaderDocumentModel("", input, {}, cache);
  const refreshed = createReaderDocumentModel("", { ...input, title: "Renamed" }, {}, cache);
  assert.equal(cache.size, 600);
  refreshed.renderableBlocks.forEach((b, i) => assert.equal(b.tokens, before.renderableBlocks[i].tokens));
  const changed = createReaderDocumentModel("", article(input.blocks.map((b, i) => i === 300 ? { ...b, text: "Changed text." } : b)), {}, cache);
  assert.notEqual(changed.renderableBlocks[300].tokens, refreshed.renderableBlocks[300].tokens);
  assert.equal(changed.renderableBlocks[301].tokens, refreshed.renderableBlocks[301].tokens);
  const plain = createReaderDocumentModel("First line.\n\nLast line.\n", null, {}, cache);
  assert.deepEqual(plain.renderableBlocks.map(b => b.plainText), ["First line.", "", "Last line.", ""]);
  assert.equal(cache.size, 4);
});

test("translation repository retains legacy Storage format, per-content identity and mutation isolation", () => {
  for (const storage of [new MemoryStorage(), new LearningStorage(new MemoryStorage(), new IDBFactory())]) {
    const events: string[] = [];
    const repo = createTranslationCacheRepository(storage, kind => events.push(kind));
    repo.setArticle("article", [translated]);
    repo.setBlocks([block], [translated]);
    assert.deepEqual(repo.getArticle("article"), [translated]);
    assert.deepEqual(repo.getBlock(block), translated);
    assert.equal(repo.getBlock({ ...block, text: "Edited body" }), null);
    const read = repo.getArticle("article")!;
    read[0].translation = "caller mutation";
    assert.deepEqual(repo.getArticle("article"), [translated]);
    assert.deepEqual(JSON.parse(storage.getItem(ARTICLE_CACHE)!), { article: [translated] });
    repo.setBlocks([{ ...block, id: "other" }], [{ ...translated, id: "other" }]);
    repo.removeBlocks([block]);
    assert.equal(repo.getBlock(block), null);
    assert.ok(repo.getBlock({ ...block, id: "other" }));
    repo.removeArticle("article");
    assert.equal(repo.getArticle("article"), null);
    assert.equal(events.filter(kind => kind === "article_translation").length, 2);
    storage.setItem(ARTICLE_CACHE, JSON.stringify({ accountB: [translated] }));
    assert.equal(repo.getArticle("article"), null, "no stale account cache");
    assert.deepEqual(repo.getArticle("accountB"), [translated]);
    if (storage instanceof LearningStorage) storage.close();
  }
});

test("translation indexed hot path never serializes unrelated history and persists delta across reload", async () => {
  const legacy = new MemoryStorage(), factory = new IDBFactory();
  const rows = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`unrelated-${i}`, { ...translated, id: `unrelated-${i}` }]));
  legacy.setItem(BLOCK_CACHE, JSON.stringify(rows));
  const storage = new LearningStorage(legacy, factory);
  await storage.initialize();
  const nativeGet = storage.getItem.bind(storage);
  let fullReads = 0;
  storage.getItem = key => { if (key === BLOCK_CACHE || key === ARTICLE_CACHE) fullReads++; return nativeGet(key); };
  const repo = createTranslationCacheRepository(storage);
  repo.setBlocks([block], [translated]);
  repo.setArticle("current", [translated]);
  assert.deepEqual(repo.getBlock(block), translated);
  assert.deepEqual(repo.getBlocks([block]), [translated]);
  assert.deepEqual(repo.getArticle("current"), [translated]);
  repo.removeBlocks([block]);
  repo.removeArticle("current");
  assert.equal(fullReads, 0);
  await storage.flush();
  const next = new LearningStorage(legacy, factory);
  await next.initialize();
  assert.equal(next.getRecord(BLOCK_CACHE, createArticleTranslationBlockCacheKey(block)), undefined);
  assert.equal(next.getRecords(BLOCK_CACHE).length, 2500);
  assert.equal(next.getRecord(ARTICLE_CACHE, "current"), undefined);
  next.close(); storage.close();
});

test("translation progress replaces one result without deleting old regeneration progress or mutating snapshots", () => {
  const blocks = [block, { ...block, id: "two" }];
  const old = { ...translated, translation: "旧译文" };
  const progress = createArticleTranslationProgress(blocks, [old]);
  const first = progress.accept({ ...translated, id: "two" });
  assert.deepEqual(first.translations.map(t => t.id), ["one", "two"]);
  assert.equal(first.translations[0].translation, "旧译文");
  const second = progress.accept(translated);
  assert.equal(second.translations[0].translation, translated.translation);
  assert.equal(first.translations[0].translation, "旧译文");
  assert.equal(progress.accept(translated).completedTargetBlocks, 2);
});

test("translation transport handles split UTF8/NDJSON chunks and releases its reader", async () => {
  const original = globalThis.fetch;
  let stream: ReadableStream<Uint8Array>;
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    assert.deepEqual(JSON.parse(String(init?.body)), { blocks: [block], contextBlocks: [block] });
    assert.equal((init?.headers as Record<string, string>)["x-context-translation-action-id"], "one-action");
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "translation", translation: translated }) + "\r\n");
    stream = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
    return new Response(stream);
  };
  try {
    const emitted: ArticleTranslationItem[] = [];
    assert.deepEqual(await requestArticleTranslation([block], new AbortController().signal, [block], "one-action", () => {}, value => emitted.push(value)), [translated]);
    assert.deepEqual(emitted, [translated]);
    assert.equal(stream!.locked, false);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(requestArticleTranslation([block], cancelled.signal, [block], "cancelled", () => {}, () => {}), { name: "AbortError" });
    assert.equal(requests, 1, "already cancelled work performs no network request");
  } finally { globalThis.fetch = original; }
});
