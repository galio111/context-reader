import type { ArticleTranslationBlock } from "@/types/reader";

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function createArticleTranslationCacheKey(blocks: ArticleTranslationBlock[]): string {
  return hashText(JSON.stringify(blocks.map((block) => [block.id, block.type, block.text])));
}

export function createArticleTranslationBlockCacheKey(block: ArticleTranslationBlock): string {
  return hashText(JSON.stringify([block.id, block.type, block.text]));
}
