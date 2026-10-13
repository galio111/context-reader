import type { VocabularyEntry } from "@/types/vocabulary";
import { normalizeVocabularySearch } from "./vocabularySearch";

export function matchesStudyVocabulary(entry: VocabularyEntry, query: string): boolean {
  const normalized = normalizeVocabularySearch(query);
  if (!normalized) return true;
  if (normalizeVocabularySearch(entry.word).startsWith(normalized)) return true;
  // English queries search the headword, not incidental English or POS labels
  // in a definition. Chinese queries can still find the saved meaning.
  return /\p{Script=Han}/u.test(normalized)
    && [entry.basicMeaning, entry.contextMeaning].some(meaning =>
      normalizeVocabularySearch(meaning ?? "").includes(normalized));
}
