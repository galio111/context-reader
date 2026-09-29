import test from "node:test";
import assert from "node:assert/strict";
import { ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS, ARTICLE_TRANSLATION_BATCH_MAX_CHARS, createArticleTranslationBatches } from "../lib/articleTranslationBatching";
import type { ArticleTranslationBlock } from "../types/reader";

test("long article translation keeps every target block in bounded ordered batches", () => {
  const blocks: ArticleTranslationBlock[] = Array.from({ length: 32 }, (_, index) => ({
    id: `p${index}`, type: "paragraph", text: "a".repeat(700),
  }));
  const batches = createArticleTranslationBatches(blocks);
  assert.deepEqual(batches.flat().map(block => block.id), blocks.map(block => block.id));
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    assert.ok(batch.length <= ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS);
    assert.ok(batch.reduce((total, block) => total + block.text.length, 0) <= ARTICLE_TRANSLATION_BATCH_MAX_CHARS);
  }
});
