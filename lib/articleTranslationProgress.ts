import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

/** Job-owned progress; replaced translations never mutate a previously published snapshot. */
export function createArticleTranslationProgress(blocks: ArticleTranslationBlock[], initial: ArticleTranslationItem[]) {
  const blockById = new Map(blocks.map(block => [block.id, block]));
  const translationsById = new Map(initial.map(item => [item.id, item]));
  const completedTargetIds = new Set<string>();
  return {
    block(id: string) { return blockById.get(id); },
    accept(translation: ArticleTranslationItem) {
      translationsById.set(translation.id, translation);
      completedTargetIds.add(translation.id);
      return {
        translations: blocks.map(block => translationsById.get(block.id)).filter((item): item is ArticleTranslationItem => Boolean(item)),
        completedTargetBlocks: completedTargetIds.size,
      };
    },
  };
}
