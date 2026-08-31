import type { ReaderToken } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";

const WORD_RE = /[a-z]+(?:['-][a-z]+)*/g;
const SIMILAR_SOURCE_THRESHOLD = 0.62;
const SIMILAR_VOCABULARY_THRESHOLD = 0.7;

interface IndexedSourceSentence {
  sentence: string;
  token: ReaderToken;
  terms: Set<string>;
}

export interface SourceSentenceIndex {
  exact: Map<string, ReaderToken>;
  sentences: IndexedSourceSentence[];
  sentenceIndexesByTerm: Map<string, number[]>;
}

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
  return findBestSourceSentenceMatchInIndex(
    sourceSentence,
    selectedText,
    createSourceSentenceIndex(tokens),
  );
}

export function createSourceSentenceIndex(tokens: ReaderToken[]): SourceSentenceIndex {
  const exact = new Map<string, ReaderToken>();
  const sentences: IndexedSourceSentence[] = [];
  const sentenceIndexesByTerm = new Map<string, number[]>();

  for (const token of tokens) {
    const normalizedSentence = normalizeForSourceMatch(token.sentence);
    if (!normalizedSentence || exact.has(normalizedSentence)) {
      continue;
    }
    exact.set(normalizedSentence, token);
    const sentenceTerms = uniqueTerms(normalizedSentence);
    const sentenceIndex = sentences.length;
    sentences.push({ sentence: token.sentence, token, terms: sentenceTerms });
    for (const term of sentenceTerms) {
      const indexes = sentenceIndexesByTerm.get(term) ?? [];
      indexes.push(sentenceIndex);
      sentenceIndexesByTerm.set(term, indexes);
    }
  }

  return { exact, sentences, sentenceIndexesByTerm };
}

export function findBestSourceSentenceMatchInIndex(
  sourceSentence: string,
  selectedText: string,
  index: SourceSentenceIndex,
): { sentence: string; token: ReaderToken; score: number } | null {
  const selectedTerms = terms(selectedText);
  if (selectedTerms.length === 0) {
    return null;
  }

  const candidateIndexes = index.sentenceIndexesByTerm.get(selectedTerms[0]) ?? [];
  let best: { sentence: string; token: ReaderToken; score: number } | null = null;

  for (const candidateIndex of candidateIndexes) {
    const candidate = index.sentences[candidateIndex];
    if (!candidate || !selectedTerms.every((term) => candidate.terms.has(term))) {
      continue;
    }

    const score = sourceSentenceSimilarity(sourceSentence, candidate.sentence);
    if (score < SIMILAR_SOURCE_THRESHOLD) {
      continue;
    }
    if (!best || score > best.score) {
      best = { sentence: candidate.sentence, token: candidate.token, score };
    }
  }

  return best;
}
