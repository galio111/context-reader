import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { ArticleTranslationBlock, ArticleTranslationItem, WordExplanation } from "@/types/reader";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
import { currentFormPhonetic } from "@/lib/pronunciation";

const EXPLANATION_CACHE_KEY = "context-reader:explanations:v5";
const ARTICLE_TRANSLATION_CACHE_KEY = "context-reader:article-translations:v1";
const ARTICLE_TRANSLATION_BLOCK_CACHE_KEY = "context-reader:article-translation-blocks:v1";

type ExplanationCache = Record<string, WordExplanation>;
type ArticleTranslationCache = Record<string, ArticleTranslationItem[]>;
type ArticleTranslationBlockCache = Record<string, ArticleTranslationItem>;

function readCache(): ExplanationCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(EXPLANATION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ExplanationCache) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: ExplanationCache): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(EXPLANATION_CACHE_KEY, JSON.stringify(cache));
    notifyAccountDataChanged(["explanation"]);
  } catch {
    // Cache failure should not break reading.
  }
}

export function createExplanationCacheKey(word: string, sentence: string): string {
  return `${word.trim().toLowerCase()}::${sentence.trim().toLowerCase()}`;
}

export function getCachedExplanation(key: string): WordExplanation | null {
  const cached = readCache()[key];
  if (!cached) {
    return null;
  }
  const selectedWord = key.split("::", 1)[0].trim();
  const isPhrase = selectedWord.split(/\s+/).filter(Boolean).length > 1;
  const cachedLemmaWords = String(cached.lemma ?? "").match(/[a-z]+(?:['’-][a-z]+)*/gi) ?? [];
  const lemma = isPhrase
    ? ""
    : cachedLemmaWords.length === 1
      ? cachedLemmaWords[0].toLowerCase()
      : selectedWord.toLowerCase();
  const phonetic = currentFormPhonetic({
    word: selectedWord || cached.word,
    lemma,
    phonetic: cached.phonetic ?? "",
    phoneticFor: cached.phoneticFor,
  });
  return {
    ...cached,
    word: selectedWord || cached.word,
    lemma,
    phonetic,
    phoneticFor: phonetic ? selectedWord || cached.word : "",
    collocation: cached.collocation || "无固定搭配",
    anki: normalizeAnkiInfo(cached, ""),
  };
}

export function setCachedExplanation(key: string, explanation: WordExplanation): void {
  const cache = readCache();
  cache[key] = explanation;
  writeCache(cache);
}

export function getExplanationCacheEntries(): Array<{ cacheKey: string; explanation: WordExplanation }> {
  return Object.entries(readCache()).map(([cacheKey, explanation]) => ({
    cacheKey,
    explanation: {
      ...explanation,
      phoneticFor: explanation.phoneticFor ?? "",
      anki: normalizeAnkiInfo(explanation, ""),
    },
  }));
}

function readArticleTranslationCache(): ArticleTranslationCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(ARTICLE_TRANSLATION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ArticleTranslationCache) : {};
  } catch {
    return {};
  }
}

function readArticleTranslationBlockCache(): ArticleTranslationBlockCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(ARTICLE_TRANSLATION_BLOCK_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ArticleTranslationBlockCache) : {};
  } catch {
    return {};
  }
}

export function getCachedArticleTranslationForBlock(block: ArticleTranslationBlock): ArticleTranslationItem | null {
  return readArticleTranslationBlockCache()[createArticleTranslationBlockCacheKey(block)] ?? null;
}

function writeArticleTranslationCache(cache: ArticleTranslationCache): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ARTICLE_TRANSLATION_CACHE_KEY, JSON.stringify(cache));
    notifyAccountDataChanged(["article_translation"]);
  } catch {
    // Translation cache failure should not block reading.
  }
}

function writeArticleTranslationBlockCache(cache: ArticleTranslationBlockCache): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ARTICLE_TRANSLATION_BLOCK_CACHE_KEY, JSON.stringify(cache));
    notifyAccountDataChanged(["translation_block"]);
  } catch {
    // Translation cache failure should not block reading.
  }
}

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

export function getCachedArticleTranslation(key: string): ArticleTranslationItem[] | null {
  const cached = readArticleTranslationCache()[key];
  return Array.isArray(cached) && cached.length > 0 ? cached : null;
}

export function setCachedArticleTranslation(key: string, translations: ArticleTranslationItem[]): void {
  const cache = readArticleTranslationCache();
  cache[key] = translations;
  writeArticleTranslationCache(cache);
}

export function removeCachedArticleTranslation(key: string): void {
  const cache = readArticleTranslationCache();
  if (!(key in cache)) {
    return;
  }
  delete cache[key];
  writeArticleTranslationCache(cache);
}

export function getCachedArticleTranslationForBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationItem[] {
  const cache = readArticleTranslationBlockCache();
  return blocks
    .map((block) => cache[createArticleTranslationBlockCacheKey(block)])
    .filter((item): item is ArticleTranslationItem => Boolean(item?.id && item.translation));
}

export function setCachedArticleTranslationForBlocks(
  blocks: ArticleTranslationBlock[],
  translations: ArticleTranslationItem[],
): void {
  const cache = readArticleTranslationBlockCache();
  const blockById = new Map(blocks.map((block) => [block.id, block]));

  for (const translation of translations) {
    const block = blockById.get(translation.id);
    if (!block || !translation.translation.trim()) {
      continue;
    }
    cache[createArticleTranslationBlockCacheKey(block)] = translation;
  }

  writeArticleTranslationBlockCache(cache);
}

export function removeCachedArticleTranslationForBlocks(blocks: ArticleTranslationBlock[]): void {
  const cache = readArticleTranslationBlockCache();
  let changed = false;

  for (const block of blocks) {
    const key = createArticleTranslationBlockCacheKey(block);
    if (key in cache) {
      delete cache[key];
      changed = true;
    }
  }

  if (changed) {
    writeArticleTranslationBlockCache(cache);
  }
}

export function getArticleTranslationCacheEntries(): Array<{ cacheKey: string; translations: ArticleTranslationItem[] }> {
  return Object.entries(readArticleTranslationCache())
    .filter(([, translations]) => Array.isArray(translations) && translations.length > 0)
    .map(([cacheKey, translations]) => ({
      cacheKey,
      translations,
    }));
}
