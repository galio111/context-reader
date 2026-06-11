import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { WordExplanation } from "@/types/reader";

const EXPLANATION_CACHE_KEY = "context-reader:explanations:v4";

type ExplanationCache = Record<string, WordExplanation>;

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
  return {
    ...cached,
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
      anki: normalizeAnkiInfo(explanation, ""),
    },
  }));
}
