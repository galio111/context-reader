import type { VocabularyEntry } from "@/types/vocabulary";

export type StudyVocabularyOrder = "collected" | "alphabetical" | "random";
const alphabet = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Presentation only: never mutate saved entries or the FSRS queue. */
export function orderStudyVocabulary(entries: VocabularyEntry[], order: StudyVocabularyOrder, shuffledIds: string[] = []): VocabularyEntry[] {
  const ranks = new Map(shuffledIds.map((id, index) => [id, index]));
  const decorated = entries.map((entry, index) => {
    const time = Date.parse(entry.createdAt);
    return { entry, index, time: Number.isFinite(time) ? time : -Infinity };
  });
  decorated.sort((a, b) => {
    const chronological = () => b.time - a.time || a.index - b.index;
    if (order === "alphabetical") return alphabet.compare(a.entry.word, b.entry.word) || chronological();
    if (order === "random") return (ranks.get(a.entry.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.entry.id) ?? Number.MAX_SAFE_INTEGER) || chronological();
    return chronological();
  });
  return decorated.map(item => item.entry);
}

export function shuffleStudyVocabularyIds(ids: string[], previous: string[] = ids, random = Math.random): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  // A click should visibly reshuffle even if chance returns the same order.
  if (next.length > 1 && next.every((id, index) => id === previous[index])) next.push(next.shift()!);
  return next;
}
