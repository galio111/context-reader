import test from "node:test";
import assert from "node:assert/strict";
import { documentTranslationBlocks } from "../lib/documentTranslationBlocks";
import { createArticleTranslationBatches } from "../lib/articleTranslationBatching";
import { createArticleTranslationBlockCacheKey } from "../lib/articleTranslationIdentity";
import type { ArticleTranslationBlock } from "../types/reader";

const b = (page: number, index: number, text: string): ArticleTranslationBlock => ({ id: `doc-p${page}-b${index}`, type: "paragraph", text });

test("double-spaced PDF lines become intact sentences without changing saved source blocks", () => {
  const source = [b(5, 0, "Bacterial infection delays healing and leads to"), b(5, 1, "persistent inflammation and impaired tissue"), b(5, 2, "formation [1–3]."), b(5, 3, "Systemic treatment is limited by drug availability.")];
  const before = JSON.stringify(source);
  const targets = documentTranslationBlocks(source);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].text, source.slice(0, 3).map(x => x.text).join(" "));
  assert.match(targets[0].id, /^doc-p5-b0-joined-b2$/);
  assert.notEqual(createArticleTranslationBlockCacheKey(targets[0]), createArticleTranslationBlockCacheKey(source[0]));
  assert.deepEqual(targets[1], source[3]);
  assert.equal(JSON.stringify(source), before);
});

test("translation grouping preserves pages, labels, captions, prose boundaries and lexical hyphens", () => {
  const source = [b(1, 0, "Abstract:"), b(1, 1, "A hydrogen-bond network controls release."), b(1, 2, "An unfinished line"), b(2, 0, "continues on a different page"), b(2, 1, "1. Introduction"), b(2, 2, "A temperature-"), b(2, 3, "responsive dressing performs well."), { ...b(2, 4, "Figure 1. Network structure"), type: "caption" as const }, b(2, 5, "Inter-"), b(2, 6, "actions stabilize the network.")];
  const targets = documentTranslationBlocks(source);
  assert.equal(targets.length, 8);
  assert.equal(targets[3].text, source[3].text);
  assert.equal(targets[5].text, "A temperature-responsive dressing performs well.");
  assert.equal(targets[6].type, "caption");
  assert.equal(targets[7].text, "Interactions stabilize the network.");
});

test("hundreds of PDF lines use bounded batches rather than one provider request per line", () => {
  const source = Array.from({ length: 765 }, (_, i) => b(5 + Math.floor(i / 30), i % 30, i % 3 === 2 ? "and remains effective." : "The network regulates release"));
  const targets = documentTranslationBlocks(source);
  const batches = createArticleTranslationBatches(targets);
  assert.equal(targets.length, 255);
  assert.equal(batches.length, 26);
  assert.deepEqual(batches.flat(), targets);
});
