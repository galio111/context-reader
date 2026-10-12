import { isLearningStorage } from "@/lib/learningStorage";
import { createArticleTranslationBlockCacheKey } from "@/lib/articleTranslationIdentity";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

const ARTICLE_CACHE = "context-reader:article-translations:v1";
const BLOCK_CACHE = "context-reader:article-translation-blocks:v1";
type TranslationCacheKind = "article_translation" | "translation_block";

/** Storage-scoped access; never retains account data or reconstructs an indexed bucket for one lookup. */
export function createTranslationCacheRepository(storage: Storage | null, changed: (kind: TranslationCacheKind) => void = () => {}) {
  function readMap<T>(bucket: string): Record<string, T> {
    try { return JSON.parse(storage?.getItem(bucket) ?? "{}"); } catch { return {}; }
  }
  function read<T>(bucket: string, key: string): T | undefined {
    try {
      return storage && isLearningStorage(storage) ? storage.getRecord(bucket, key) as T | undefined : readMap<T>(bucket)[key];
    } catch { return undefined; }
  }
  function update<T>(bucket: string, values: Array<[string, T]>, deletes: string[], kind: TranslationCacheKind) {
    if (!storage) return;
    try {
      if (isLearningStorage(storage)) storage.updateRecords(bucket, values, deletes);
      else {
        const cache = readMap<T>(bucket);
        for (const key of deletes) delete cache[key];
        for (const [key, value] of values) cache[key] = value;
        storage.setItem(bucket, JSON.stringify(cache));
      }
      changed(kind);
    } catch { /* Cache persistence must not interrupt reading or erase displayed progress. */ }
  }
  return {
    getArticle(key: string): ArticleTranslationItem[] | null {
      const cached = read<ArticleTranslationItem[]>(ARTICLE_CACHE, key);
      return Array.isArray(cached) && cached.length > 0 ? cached : null;
    },
    setArticle(key: string, translations: ArticleTranslationItem[]) {
      update(ARTICLE_CACHE, [[key, translations]], [], "article_translation");
    },
    removeArticle(key: string) {
      if (read(ARTICLE_CACHE, key) !== undefined) update(ARTICLE_CACHE, [], [key], "article_translation");
    },
    getBlock(block: ArticleTranslationBlock): ArticleTranslationItem | null {
      return read<ArticleTranslationItem>(BLOCK_CACHE, createArticleTranslationBlockCacheKey(block)) ?? null;
    },
    getBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationItem[] {
      // Legacy Storage is decoded once for a group, while LearningStorage reads only requested rows.
      const legacy = storage && !isLearningStorage(storage) ? readMap<ArticleTranslationItem>(BLOCK_CACHE) : null;
      return blocks.map(block => {
        const key = createArticleTranslationBlockCacheKey(block);
        return legacy ? legacy[key] : read<ArticleTranslationItem>(BLOCK_CACHE, key);
      }).filter((item): item is ArticleTranslationItem => Boolean(item?.id && item.translation));
    },
    setBlocks(blocks: ArticleTranslationBlock[], translations: ArticleTranslationItem[]) {
      const blockById = new Map(blocks.map(block => [block.id, block]));
      const values: Array<[string, ArticleTranslationItem]> = [];
      for (const translation of translations) {
        const block = blockById.get(translation.id);
        if (block && translation.translation.trim()) values.push([createArticleTranslationBlockCacheKey(block), translation]);
      }
      update(BLOCK_CACHE, values, [], "translation_block");
    },
    removeBlocks(blocks: ArticleTranslationBlock[]) {
      const legacy = storage && !isLearningStorage(storage) ? readMap<ArticleTranslationItem>(BLOCK_CACHE) : null;
      const keys = blocks.map(createArticleTranslationBlockCacheKey).filter(key =>
        legacy ? Object.prototype.hasOwnProperty.call(legacy, key) : read(BLOCK_CACHE, key) !== undefined);
      if (keys.length) update(BLOCK_CACHE, [], keys, "translation_block");
    },
    entries(): Array<{ cacheKey: string; translations: ArticleTranslationItem[] }> {
      return Object.entries(readMap<ArticleTranslationItem[]>(ARTICLE_CACHE))
        .filter(([, value]) => Array.isArray(value) && value.length > 0)
        .map(([cacheKey, translations]) => ({ cacheKey, translations }));
    },
  };
}
