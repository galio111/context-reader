import type { ArticleTranslationBlock } from "@/types/reader";

// Keep each provider stream comfortably below its output and time limits while
// still sending the complete article as context for every batch.
export const ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS = 10;
export const ARTICLE_TRANSLATION_BATCH_MAX_CHARS = 5_000;

export function createArticleTranslationBatches(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[][] {
  const batches: ArticleTranslationBlock[][] = [];
  let currentBatch: ArticleTranslationBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    const shouldStartNextBatch = currentBatch.length > 0 && (
      currentBatch.length >= ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS
      || currentChars + block.text.length > ARTICLE_TRANSLATION_BATCH_MAX_CHARS
    );
    if (shouldStartNextBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(block);
    currentChars += block.text.length;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}
