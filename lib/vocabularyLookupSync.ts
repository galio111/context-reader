import { normalizeAnkiInfo } from "./ankiData";
import { normalizeDictionaryQuery, type StandaloneDictionaryCacheItem } from "./dictionaryResultSnapshot";
import { createStandaloneVocabularyEntry } from "./standaloneDictionary";
import type { WordExplanation } from "../types/reader";
import type { VocabularyEntry } from "../types/vocabulary";

/** A dictionary query is distinct from the preferred English translation. */
export function standaloneVocabularyQuery(entry: Pick<VocabularyEntry, "word" | "sourceSentence" | "anki" | "dictionaryResult">): string | null {
  if (entry.sourceSentence.trim()
    || !["basic_en_to_cn", "basic_cn_to_en_dictionary"].includes(entry.anki.cardMode)) return null;
  return entry.dictionaryResult?.query
    || (entry.anki.cardMode === "basic_cn_to_en_dictionary" ? entry.anki.basicCue : entry.word)
    || null;
}

function normalizedContext(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function reconcileStandaloneVocabulary(
  entry: VocabularyEntry,
  snapshot: StandaloneDictionaryCacheItem,
): VocabularyEntry {
  const query = standaloneVocabularyQuery(entry);
  if (!query || normalizeDictionaryQuery(query) !== snapshot.normalizedQuery) return entry;
  // Imported/legacy entries predate content timestamps. Their existing update
  // time is the conservative bound until the first successful regeneration.
  if (Date.parse(snapshot.updatedAt) < Date.parse(entry.dictionaryUpdatedAt || entry.updatedAt)) return entry;
  if (entry.dictionaryUpdatedAt === snapshot.updatedAt
    && entry.dictionaryResult && JSON.stringify(entry.dictionaryResult) === JSON.stringify(snapshot.result)) return entry;
  const generated = createStandaloneVocabularyEntry(snapshot.result);
  return {
    ...entry, ...generated,
    id: entry.id, createdAt: entry.createdAt,
    updatedAt: Date.parse(entry.updatedAt) > Date.parse(snapshot.updatedAt) ? entry.updatedAt : snapshot.updatedAt,
    dictionaryUpdatedAt: snapshot.updatedAt,
    sourceSentence: entry.sourceSentence, previousSentence: entry.previousSentence,
    nextSentence: entry.nextSentence, sourceArticle: entry.sourceArticle,
    anki: {
      ...generated.anki, cardMode: entry.anki.cardMode,
      ankiNoteId: entry.anki.ankiNoteId, ankiImportedAt: entry.anki.ankiImportedAt,
    },
  };
}

/** Only exact word + source sentence matches may share a contextual result. */
export function reconcileContextualVocabulary(
  entry: VocabularyEntry,
  explanation: WordExplanation,
  context: { word: string; sentence: string },
  updatedAt: string,
): VocabularyEntry {
  if (standaloneVocabularyQuery(entry) || !context.sentence.trim()
    || normalizedContext(entry.word) !== normalizedContext(context.word)
    || normalizedContext(entry.sourceSentence) !== normalizedContext(context.sentence)) return entry;
  if (Date.parse(updatedAt) < Date.parse(entry.explanationUpdatedAt || entry.updatedAt)) return entry;
  const next: VocabularyEntry = {
    ...entry,
    lemma: explanation.lemma, phonetic: explanation.phonetic, phoneticFor: explanation.phoneticFor,
    partOfSpeech: explanation.partOfSpeech, basicMeaning: explanation.basicMeaning,
    contextMeaning: explanation.contextMeaning, sentenceTranslation: explanation.sentenceTranslation,
    usageNote: explanation.usageNote, collocation: explanation.collocation,
    exampleEnglish: explanation.exampleEnglish, exampleChinese: explanation.exampleChinese,
    difficulty: explanation.difficulty, shouldAddToVocabulary: explanation.shouldAddToVocabulary,
    anki: normalizeAnkiInfo({ ...explanation, word: entry.word, anki: {
      ...explanation.anki, cardMode: entry.anki.cardMode,
      ankiNoteId: entry.anki.ankiNoteId, ankiImportedAt: entry.anki.ankiImportedAt,
    } }, entry.sourceSentence),
  };
  // An imported basic/cloze choice is a study identity, not generated content.
  next.anki.cardMode = entry.anki.cardMode;
  if (entry.explanationUpdatedAt === updatedAt && JSON.stringify(next) === JSON.stringify(entry)) return entry;
  return { ...next, updatedAt: Date.parse(entry.updatedAt) > Date.parse(updatedAt) ? entry.updatedAt : updatedAt,
    explanationUpdatedAt: updatedAt };
}
