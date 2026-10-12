import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { createReaderDocumentModel } from "../lib/readerDocumentModel";
import { groupReaderTokensByInline, tokenizeReaderBlockText } from "../lib/readerBlockTokens";
import { scopeReaderTokenId } from "../lib/readerTokenIdentity";
import { createSourceSentenceIndex, normalizeForSourceMatch } from "../lib/sourceMatching";
import type { ImportedArticle, ImportedArticleBlock } from "../types/article";

// Execute the exact old useMemo expressions, extracted from the accepted source.
// Expected results do not copy the new compiler's implementation.
const baseline = process.env.AUDIT_BASELINE || "4d0d91106087951d8d4271b46a328c0908f869d3";
const text = execFileSync("git", ["show", baseline + ":components/ReaderView.tsx"], { encoding: "utf8", maxBuffer: 2_000_000 });
const source = ts.createSourceFile("ReaderView.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const currentSource = ts.createSourceFile("ReaderView.tsx", readFileSync("components/ReaderView.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function jsxSyntax(file: ts.SourceFile) {
  const expressions: string[] = [];
  const walk = (node: ts.Node) => { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) expressions.push(node.getText(file)); else ts.forEachChild(node, walk); };
  walk(file); return expressions;
}
assert.deepEqual(jsxSyntax(currentSource), jsxSyntax(source), "all Reader JSX markup and expression syntax remain identical");
const declarations = new Map<string, string>(), functions = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer.getText(source));
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
const names = ["plainArticleParagraphs", "effectiveImportedArticle", "renderableBlocks", "wordTokens", "tokenBlockIdByTokenId", "tokenById", "wordTokensByParagraph", "sourceSentenceSet", "sourceSentenceIndex", "sourceWordSet"];
for (const name of names) assert.ok(declarations.has(name), "baseline initializer exists: " + name);
const code = `${functions.get("importedBlockText")}\n${functions.get("inlinePlainText")}\nreturn function baselineModel(currentArticle, currentImportedArticle, imageOcr) { const articleTokenCacheRef = {current: new Map()}; const IMAGE_OCR_ENABLED = false; ${names.map(name => `const ${name} = ${declarations.get(name)};`).join("\n")} return {${names.slice(2).join(",")}}; }`;
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const baselineModel = new Function("useMemo", "groupReaderTokensByInline", "tokenizeReaderBlockText", "scopeReaderTokenId", "createSourceSentenceIndex", "normalizeForSourceMatch", compiled)((callback: () => unknown) => callback(), groupReaderTokensByInline, tokenizeReaderBlockText, scopeReaderTokenId, createSourceSentenceIndex, normalizeForSourceMatch);
const normalize = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Map ? { map: [...item] } : item instanceof Set ? { set: [...item] } : item);
const cases: Array<{ name: string; article: string; imported: ImportedArticle | null }> = [];
cases.push({ name: "plain CRLF and explicit empty paragraphs", article: "Opening title\r\n\r\nThe café’s well-read author can't wait.\n\n\nSame sentence. Same sentence.\n", imported: null });
cases.push({ name: "long document above old 400 cache threshold", article: Array.from({ length: 470 }, (_, i) => `Section ${i}. The thoughtful writer carefully preserves every detail.`).join("\n"), imported: null });
const blocks: ImportedArticleBlock[] = [
  { id: "heading", type: "heading", text: "Mixed structure" },
  { id: "blank", type: "paragraph", text: "   " },
  { id: "subheading", type: "subheading", text: "Evidence and context" },
  { id: "inline", type: "paragraph", text: "The CO2 estimate is 103 units.", inline: [{ text: "The CO" }, { text: "2", baseline: "sub" }, { text: " estimate is 10" }, { text: "3", baseline: "sup" }, { text: " units." }] },
  { id: "mismatched-inline", type: "paragraph", text: "Authoritative plain text.", inline: [{ text: "Stale formatting" }] },
  { id: "quote", type: "quote", text: "The café’s well-read author can't wait." },
  { id: "list", type: "list-item", text: "A structured item.", listStyle: "ordered", listOrdinal: 4, listLevel: 2 },
  { id: "photo", type: "image", src: "https://example.com/figure.webp", alt: "  A coastal observatory.  ", width: 1600, height: 900, ocrText: "Must not become reader tokens.", layoutWords: [{ text: "stored", x: 0, y: 0, width: 20, height: 10, lineText: "stored metadata" }] },
  { id: "caption", type: "caption", text: "A separate caption remains a text block." },
  { id: "table", type: "table", table: { caption: "Measurements", rows: [[{ text: "Reading", header: true, scope: "col", colSpan: 2 }, { text: "" }], [{ text: "Accurate observations", rowSpan: 2 }, { text: "7.5" }]] } },
  { id: "legacy-table", type: "table", text: "A legacy table without structured cells." },
  { id: "image-empty", type: "image", src: "https://example.com/empty.webp", alt: "" },
  { id: "duplicates", type: "paragraph", text: "The café’s well-read author can't wait. THE CAFÉ’S WELL-READ AUTHOR CAN'T WAIT." },
];
const imported = { title: "Mixed structure", url: "https://example.com/article", siteName: "Fixture", text: "mixed body", blocks } as ImportedArticle;
cases.push({ name: "all shipped imported block kinds and legacy metadata", article: imported.text, imported });
cases.push({ name: "same IDs with edited text, insertion, deletion and index shifts", article: imported.text, imported: { ...imported, blocks: [{ id: "new", type: "paragraph", text: "New leading context." }, ...blocks.filter(block => block.id !== "blank").map(block => block.id === "quote" ? { ...block, text: "An edited source sentence." } : block)] } });
const cache = new Map(), results = [];
for (const fixture of cases) {
  const expected = baselineModel(fixture.article, fixture.imported, {});
  const actual = createReaderDocumentModel(fixture.article, fixture.imported, {}, cache);
  for (const name of names.slice(2)) assert.equal(normalize(actual[name as keyof typeof actual]), normalize(expected[name]), fixture.name + ": " + name);
  const repeat = createReaderDocumentModel(fixture.article, fixture.imported, {}, cache);
  assert.equal(normalize(repeat.renderableBlocks), normalize(expected.renderableBlocks));
  const expectedSentences = new Map<string, unknown[]>();
  for (const token of expected.wordTokens) { const key = normalizeForSourceMatch(token.sentence); expectedSentences.set(key, [...(expectedSentences.get(key) || []), token]); }
  assert.equal(normalize(actual.wordTokensBySentence), normalize(expectedSentences));
  results.push({ name: fixture.name, blocks: actual.renderableBlocks.length, words: actual.wordTokens.length, cacheEntries: cache.size, passed: true });
}
const output = process.env.AUDIT_OUTPUT || "artifacts/architecture-audit"; mkdirSync(output, { recursive: true });
writeFileSync(output + "/reader-model-differential.json", JSON.stringify({ baseline, jsxSyntaxUnchanged: true, jsxRoots: jsxSyntax(source).length, results }, null, 2));
console.log(JSON.stringify(results, null, 2));
