import type { ArticleTranslationBlock } from "@/types/reader";

export const ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS = 80;
export const ARTICLE_TRANSLATION_BATCH_MAX_CHARS = 24_000;

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
