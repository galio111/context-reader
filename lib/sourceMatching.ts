import type { ReaderToken } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";

const WORD_RE = /[a-z]+(?:['-][a-z]+)*/g;
const SIMILAR_SOURCE_THRESHOLD = 0.62;
const SIMILAR_VOCABULARY_THRESHOLD = 0.7;

export function normalizeForSourceMatch(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function terms(value: string): string[] {
  return normalizeForSourceMatch(value).match(WORD_RE) ?? [];
}

function uniqueTerms(value: string): Set<string> {
  return new Set(terms(value));
}

export function sourceSentenceSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeForSourceMatch(left);
  const normalizedRight = normalizeForSourceMatch(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.92;
  }

  const leftTerms = uniqueTerms(normalizedLeft);
  const rightTerms = uniqueTerms(normalizedRight);
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftTerms.size + rightTerms.size);
}

export function selectedTextAppearsInSentence(selectedText: string, sentence: string): boolean {
  const selectedTerms = terms(selectedText);
  if (selectedTerms.length === 0) {
    return false;
  }
  const sentenceTerms = uniqueTerms(sentence);
  return selectedTerms.every((term) => sentenceTerms.has(term));
}

export function vocabularyWordsMatch(left: string, right: string): boolean {
  return normalizeForSourceMatch(left) === normalizeForSourceMatch(right);
}

export function findSimilarVocabularyEntry(
  entries: VocabularyEntry[],
  selectedText: string,
  sourceSentence: string,
): VocabularyEntry | null {
  let best: { entry: VocabularyEntry; score: number } | null = null;

  for (const entry of entries) {
    if (!vocabularyWordsMatch(entry.word, selectedText)) {
      continue;
    }
    const score = sourceSentenceSimilarity(entry.sourceSentence, sourceSentence);
    if (score < SIMILAR_VOCABULARY_THRESHOLD) {
      continue;
    }
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }

  return best?.entry ?? null;
}

export function findBestSourceSentenceMatch(
  sourceSentence: string,
  selectedText: string,
  tokens: ReaderToken[],
): { sentence: string; token: ReaderToken; score: number } | null {
  const seen = new Set<string>();
  let best: { sentence: string; token: ReaderToken; score: number } | null = null;

  for (const token of tokens) {
    const normalizedSentence = normalizeForSourceMatch(token.sentence);
    if (!normalizedSentence || seen.has(normalizedSentence)) {
      continue;
    }
    seen.add(normalizedSentence);

    if (!selectedTextAppearsInSentence(selectedText, token.sentence)) {
      continue;
    }

    const score = sourceSentenceSimilarity(sourceSentence, token.sentence);
    if (score < SIMILAR_SOURCE_THRESHOLD) {
      continue;
    }
    if (!best || score > best.score) {
      best = { sentence: token.sentence, token, score };
    }
  }

  return best;
}
