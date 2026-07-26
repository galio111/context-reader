import type { VocabularyEntry } from "@/types/vocabulary";

interface VocabularySearchItem {
  entry: VocabularyEntry;
  normalizedWord: string;
  order: number;
}

export interface VocabularySearchIndex {
  source: VocabularyEntry[];
  items: VocabularySearchItem[];
}

export function normalizeVocabularySearch(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

export function createVocabularySearchIndex(entries: VocabularyEntry[]): VocabularySearchIndex {
  return {
    source: entries,
    items: entries
      .map((entry, order) => ({
        entry,
        normalizedWord: normalizeVocabularySearch(entry.word),
        order,
      }))
      .sort((left, right) => (
        left.normalizedWord.localeCompare(right.normalizedWord, "en")
        || left.order - right.order
      )),
  };
}

function lowerBound(items: VocabularySearchItem[], target: string): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].normalizedWord.localeCompare(target, "en") < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function searchVocabularyIndex(index: VocabularySearchIndex, query: string): VocabularyEntry[] {
  const normalized = normalizeVocabularySearch(query);
  if (!normalized) return index.source;
  const start = lowerBound(index.items, normalized);
  const end = lowerBound(index.items, `${normalized}\uffff`);
  return index.items
    .slice(start, end)
    .filter((item) => item.normalizedWord.startsWith(normalized))
    .sort((left, right) => left.order - right.order)
    .map((item) => item.entry);
}
