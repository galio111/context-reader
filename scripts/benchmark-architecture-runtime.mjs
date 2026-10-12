// Run: node --import tsx scripts/benchmark-architecture-runtime.mjs [accepted-baseline-commit]
// The oracle is compiled from the accepted Reader source, not copied from the rewritten model.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { IDBFactory } from "fake-indexeddb";
import ts from "typescript";
import { createReaderDocumentModel } from "../lib/readerDocumentModel.ts";
import { createTranslationCacheRepository } from "../lib/translationCacheRepository.ts";
import { createArticleTranslationBlockCacheKey } from "../lib/articleTranslationIdentity.ts";
import { LearningStorage } from "../lib/learningStorage.ts";

const revision = process.argv[2] || "4d0d91106087951d8d4271b46a328c0908f869d3";
const source = execFileSync("git", ["show", `${revision}:components/ReaderView.tsx`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
function jsxNodes(text) {
  const file = ts.createSourceFile("ReaderView.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) nodes.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file); return nodes;
}
const originalJsx = jsxNodes(source);
assert.deepEqual(jsxNodes(readFileSync("components/ReaderView.tsx", "utf8")), originalJsx, "Reader JSX markup must remain identical");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const baseline = `
// @ts-nocheck -- temporary oracle is extracted verbatim from the accepted production component.
import { groupReaderTokensByInline, tokenizeReaderBlockText } from "@/lib/readerBlockTokens";
import { scopeReaderTokenId } from "@/lib/readerTokenIdentity";
import { createSourceSentenceIndex, normalizeForSourceMatch } from "@/lib/sourceMatching";
${section("function importedBlockText(", "function editableArticleBlockType(")}
${section("function inlinePlainText(", "function ReaderRailIcon(")}
export function compile(currentArticle, effectiveImportedArticle, imageOcr, tokenCache) {
  const articleTokenCacheRef = { current: tokenCache };
  const IMAGE_OCR_ENABLED = false;
  const plainArticleParagraphs = effectiveImportedArticle?.blocks?.length ? [] : currentArticle.split(/\\r?\\n/);
  const renderableBlocks = (() => {
${section("    const tokenCache = articleTokenCacheRef.current;", "  }, [effectiveImportedArticle, imageOcr, plainArticleParagraphs]);")}
  })();
  const wordTokens = renderableBlocks.flatMap(block => [...(block.tokens?.filter(token => token.type === "word") ?? []), ...(block.captionTokens?.filter(token => token.type === "word") ?? [])]);
  const tokenBlockIdByTokenId = new Map();
  for (const block of renderableBlocks) {
    for (const token of block.tokens ?? []) tokenBlockIdByTokenId.set(token.id, block.id);
    for (const token of block.captionTokens ?? []) tokenBlockIdByTokenId.set(token.id, block.id);
  }
  const tokenById = new Map(wordTokens.map(token => [token.id, token]));
  const wordTokensByParagraph = new Map();
  for (const token of wordTokens) {
    const tokens = wordTokensByParagraph.get(token.paragraphIndex) ?? [];
    tokens.push(token); wordTokensByParagraph.set(token.paragraphIndex, tokens);
  }
  const sourceSentenceSet = new Set(wordTokens.map(token => normalizeForSourceMatch(token.sentence)).filter(Boolean));
  const sourceSentenceIndex = createSourceSentenceIndex(wordTokens);
  const sourceWordSet = new Set(wordTokens.map(token => normalizeForSourceMatch(token.value)).filter(Boolean));
  return { renderableBlocks, wordTokens, tokenBlockIdByTokenId, tokenById, wordTokensByParagraph, sourceSentenceSet, sourceSentenceIndex, sourceWordSet };
}
`;
mkdirSync("artifacts/architecture-runtime", { recursive: true });
const baselinePath = resolve("artifacts/architecture-runtime/baseline-reader-model.ts");
writeFileSync(baselinePath, baseline);
const { compile } = await import(pathToFileURL(baselinePath).href);
const makeArticle = blocks => ({ title: "Benchmark", text: "", url: "", siteName: "", blocks });
const mixed = makeArticle([
  { id: "h", type: "heading", text: "Reading and remembering." },
  { id: "p", type: "paragraph", text: "Water H2O stays clear.", inline: [{ text: "Water H" }, { text: "2", baseline: "sub" }, { text: "O stays clear." }] },
  { id: "b", type: "paragraph", text: "  " },
  { id: "t", type: "table", table: { rows: [[{ text: "Alpha", header: true }, { text: "" }], [{ text: "Beta" }, { text: "Reading and remembering." }]] } },
  { id: "i", type: "image", alt: "A small boat.", src: "/image.webp", width: 1000, height: 600, ocrText: "Legacy hidden text." },
  { id: "l", type: "list-item", text: "A reader's well-being—中文 punctuation.", listStyle: "ordered", listOrdinal: 4, listLevel: 2 },
]);
let equivalentDocuments = 0;
for (const [text, input] of [["First paragraph.\n\nLast paragraph.\n", null], ["", mixed], ...Array.from({ length: 20 }, (_, k) => ["", makeArticle(Array.from({ length: k * 11 }, (_, i) => ({ id: `b${i}`, type: i % 3 === 0 ? "quote" : "paragraph", text: i % 7 === 0 ? "" : `Repeated sentence. Paragraph ${i} has a well-chosen word. Same sentence!` })))])]) {
  const old = compile(text, input, {}, new Map());
  const { wordTokensBySentence: _, ...current } = createReaderDocumentModel(text, input, {}, new Map());
  assert.deepEqual(current, old);
  equivalentDocuments++;
}

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = action => { const values = []; for (let i = 0; i < 13; i++) { const start = performance.now(); action(); if (i >= 3) values.push(performance.now() - start); } return Number(median(values).toFixed(3)); };
const reader = [];
for (const count of [100, 600, 1200]) {
  const input = makeArticle(Array.from({ length: count }, (_, i) => ({ id: `b${i}`, type: "paragraph", text: `Reading paragraph ${i} helps us understand how ideas connect. A deliberate reading session gives each unfamiliar expression enough context for learning.` })));
  const oldCache = new Map(), newCache = new Map();
  compile("", input, {}, oldCache); createReaderDocumentModel("", input, {}, newCache);
  reader.push({ blocks: count,
    coldBeforeMs: measure(() => compile("", input, {}, new Map())),
    coldAfterMs: measure(() => createReaderDocumentModel("", input, {}, new Map())),
    refreshBeforeMs: measure(() => compile("", { ...input }, {}, oldCache)),
    refreshAfterMs: measure(() => createReaderDocumentModel("", { ...input }, {}, newCache)),
  });
}

class MemoryStorage {
  data = new Map(); get length() { return this.data.size; } key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { return this.data.get(k) ?? null; } setItem(k, v) { this.data.set(k, v); } removeItem(k) { this.data.delete(k); } clear() { this.data.clear(); }
}
const bucket = "context-reader:article-translation-blocks:v1";
const target = { id: "target", type: "paragraph", text: "The source sentence." };
const targetKey = createArticleTranslationBlockCacheKey(target);
const values = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`row${i}`, { id: `row${i}`, translation: "用于测量历史译文缓存读取与写入的中文内容。".repeat(4) }]));
values[targetKey] = { id: "target", translation: "目标译文" };
const seed = JSON.stringify(values);
const makeStorage = () => { const legacy = new MemoryStorage(); legacy.setItem(bucket, seed); return new LearningStorage(legacy, new IDBFactory()); };
const oldStore = makeStorage(), newStore = makeStorage();
const repo = createTranslationCacheRepository(newStore);
const translationCache = {
  rows: 5001, serializedCharacters: seed.length,
  readBeforeMs: measure(() => { for (let i = 0; i < 50; i++) JSON.parse(oldStore.getItem(bucket))[targetKey]; }),
  readAfterMs: measure(() => { for (let i = 0; i < 50; i++) repo.getBlock(target); }),
};
let revisionNumber = 0;
translationCache.writeBeforeMs = measure(() => { const map = JSON.parse(oldStore.getItem(bucket)); map[targetKey] = { id: "target", translation: `新译文${revisionNumber++}` }; oldStore.setItem(bucket, JSON.stringify(map)); });
translationCache.writeAfterMs = measure(() => repo.setBlocks([target], [{ id: "target", translation: `新译文${revisionNumber++}` }]));
oldStore.close(); newStore.close();
const report = { baselineRevision: revision, identicalReaderJsxNodes: originalJsx.length, equivalentDocuments, reader, translationCache, note: "Local CPU microbenchmarks; not network, whole-page load or physical-device acceptance." };
writeFileSync("artifacts/architecture-runtime/benchmark.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
