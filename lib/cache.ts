
import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { ArticleTranslationBlock, ArticleTranslationItem, WordExplanation } from "@/types/reader";
import { createTranslationCacheRepository } from "@/lib/translationCacheRepository";

export {
  createArticleTranslationBlockCacheKey,
  createArticleTranslationCacheKey,
} from "@/lib/articleTranslationIdentity";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
import { currentFormPhonetic } from "@/lib/pronunciation";
import { replaceMatchingVocabularyEntry } from "@/lib/vocabulary";

const EXPLANATION_CACHE_KEY = "context-reader:explanations:v5";

type ExplanationCache = Record<string, WordExplanation>;
type ArticleTranslationCache = Record<string, ArticleTranslationItem[]>;
type ArticleTranslationBlockCache = Record<string, ArticleTranslationItem>;

function readCache(): ExplanationCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = getLearningStorage().getItem(EXPLANATION_CACHE_KEY);
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
    getLearningStorage().setItem(EXPLANATION_CACHE_KEY, JSON.stringify(cache));
    notifyAccountDataChanged(["explanation"]);
  } catch {
    // Cache failure should not break reading.
  }
}

export function createExplanationCacheKey(word: string, sentence: string): string {
  return `${word.trim().toLowerCase()}::${sentence.trim().toLowerCase()}`;
}

export function getCachedExplanation(key: string): WordExplanation | null {
  const storage = typeof window === "undefined" ? null : getLearningStorage();
  const cached = storage && isLearningStorage(storage) ? storage.getRecord(EXPLANATION_CACHE_KEY, key) as WordExplanation | undefined : readCache()[key];
  if (cached && storage && isLearningStorage(storage)) storage.setRecord("context-reader:cache-access:v1", key, Date.now());
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
  const storage = getLearningStorage();
  const saved = { ...explanation, cacheUpdatedAt: new Date().toISOString() };
  if (isLearningStorage(storage)) {
    storage.setRecord(EXPLANATION_CACHE_KEY, key, saved);
    notifyAccountDataChanged(["explanation"]);
  } else {
    const cache = readCache();
    cache[key] = saved;
    writeCache(cache);
  }
  const separator = key.indexOf("::");
  if (separator >= 0) replaceMatchingVocabularyEntry(saved, {
    word: key.slice(0, separator), sentence: key.slice(separator + 2),
    previousSentence: "", nextSentence: "", paragraphIndex: 0, tokenIndex: 0,
  });
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

function translationCache() {
  let storage: Storage | null = null;
  try { if (typeof window !== "undefined") storage = getLearningStorage(); } catch { /* Browser storage may be unavailable. */ }
  return createTranslationCacheRepository(storage, kind => notifyAccountDataChanged([kind]));
}

export function getCachedArticleTranslationForBlock(block: ArticleTranslationBlock): ArticleTranslationItem | null {
  return translationCache().getBlock(block);
}

export function getCachedArticleTranslation(key: string): ArticleTranslationItem[] | null {
  return translationCache().getArticle(key);
}

export function setCachedArticleTranslation(key: string, translations: ArticleTranslationItem[]): void {
  translationCache().setArticle(key, translations);
}

export function removeCachedArticleTranslation(key: string): void {
  translationCache().removeArticle(key);
}

export function getCachedArticleTranslationForBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationItem[] {
  return translationCache().getBlocks(blocks);
}

export function setCachedArticleTranslationForBlocks(blocks: ArticleTranslationBlock[], translations: ArticleTranslationItem[]): void {
  translationCache().setBlocks(blocks, translations);
}

export function removeCachedArticleTranslationForBlocks(blocks: ArticleTranslationBlock[]): void {
  translationCache().removeBlocks(blocks);
}

export function getArticleTranslationCacheEntries(): Array<{ cacheKey: string; translations: ArticleTranslationItem[] }> {
  return translationCache().entries();
}
