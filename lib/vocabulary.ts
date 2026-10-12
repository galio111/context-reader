
import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry, VocabularySourceArticle } from "@/types/vocabulary";
import { notifyAccountObjectsDeleted } from "@/lib/accountEvents";
import { vocabularyIdentity } from "@/lib/vocabularyMerge";
import { reconcileContextualVocabulary, reconcileStandaloneVocabulary } from "@/lib/vocabularyLookupSync";
import type { StandaloneDictionaryCacheItem } from "@/lib/dictionaryResultSnapshot";

export { vocabularyIdentity } from "@/lib/vocabularyMerge";

import { getVocabularyEntries, saveVocabularyEntries } from "@/lib/vocabularyRepository";
export { getVocabularyEntries, getVocabularyEntry, saveVocabularyEntries, normalizeVocabularyEntries } from "@/lib/vocabularyRepository";

export function createVocabularyEntry(
  explanation: WordExplanation,
  context: WordContext,
  sourceArticle?: VocabularySourceArticle,
): VocabularyEntry {
  const createdAt = new Date().toISOString();
  const base = {
    id: `${explanation.word.toLowerCase()}-${Date.now()}`,
    word: explanation.word,
    lemma: explanation.lemma,
    phonetic: explanation.phonetic,
    phoneticFor: explanation.phoneticFor,
    partOfSpeech: explanation.partOfSpeech,
    basicMeaning: explanation.basicMeaning,
    contextMeaning: explanation.contextMeaning,
    sentenceTranslation: explanation.sentenceTranslation,
    usageNote: explanation.usageNote,
    collocation: explanation.collocation,
    exampleEnglish: explanation.exampleEnglish,
    exampleChinese: explanation.exampleChinese,
    sourceSentence: context.sentence,
    previousSentence: context.previousSentence,
    nextSentence: context.nextSentence,
    sourceArticle,
    difficulty: explanation.difficulty,
    shouldAddToVocabulary: explanation.shouldAddToVocabulary,
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ...base,
    anki: normalizeAnkiInfo({ ...explanation, anki: explanation.anki }, context.sentence),
  };
}

export function addVocabularyEntry(entry: VocabularyEntry): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  const entryKey = vocabularyIdentity(entry);
  if (entries.some((item) => vocabularyIdentity(item) === entryKey)) {
    return entries;
  }

  const nextEntries = [entry, ...entries];
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function updateVocabularyEntry(updatedEntry: VocabularyEntry): VocabularyEntry[] {
  const nextUpdatedEntry = { ...updatedEntry, updatedAt: new Date().toISOString() };
  const nextEntries = getVocabularyEntries().map((entry) =>
    entry.id === updatedEntry.id ? nextUpdatedEntry : entry,
  );
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function replaceMatchingVocabularyEntry(
  explanation: WordExplanation,
  context: WordContext,
  sourceArticle?: VocabularySourceArticle,
): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  const updatedAt = explanation.cacheUpdatedAt && Number.isFinite(Date.parse(explanation.cacheUpdatedAt))
    ? explanation.cacheUpdatedAt : new Date().toISOString();
  let replaced = false;

  const nextEntries = entries.map((entry) => {
    const next = reconcileContextualVocabulary(entry, explanation, context, updatedAt);
    if (next === entry) return entry;
    replaced = true;
    return {
      ...next, sourceArticle: entry.sourceArticle ?? sourceArticle,
    };
  });

  if (replaced) {
    saveVocabularyEntries(nextEntries);
  }
  return nextEntries;
}

export function replaceStandaloneVocabularyEntries(snapshot: StandaloneDictionaryCacheItem): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  let changed = false;
  const next = entries.map(entry => {
    const updated = reconcileStandaloneVocabulary(entry, snapshot);
    changed ||= updated !== entry;
    return updated;
  });
  if (changed) saveVocabularyEntries(next);
  return next;
}

export function markVocabularyEntryImported(id: string, ankiNoteId: number): VocabularyEntry[] {
  const nextEntries = getVocabularyEntries().map((entry) =>
    entry.id === id
      ? {
          ...entry,
          updatedAt: new Date().toISOString(),
          anki: {
            ...entry.anki,
            ankiNoteId,
            ankiImportedAt: new Date().toISOString(),
          },
        }
      : entry,
  );
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function markVocabularyEntriesImported(noteIdsByEntryId: ReadonlyMap<string, number>): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  if (noteIdsByEntryId.size === 0) return entries;

  const importedAt = new Date().toISOString();
  let changed = false;
  const nextEntries = entries.map((entry) => {
    const ankiNoteId = noteIdsByEntryId.get(entry.id);
    if (entry.anki.ankiNoteId || !ankiNoteId || !Number.isFinite(ankiNoteId)) return entry;
    changed = true;
    return {
      ...entry,
      updatedAt: importedAt,
      anki: {
        ...entry.anki,
        ankiNoteId,
        ankiImportedAt: importedAt,
      },
    };
  });
  if (changed) saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function deleteVocabularyEntry(id: string): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  const nextEntries = entries.filter((entry) => entry.id !== id);
  if (nextEntries.length !== entries.length) {
    notifyAccountObjectsDeleted("vocabulary", [id]);
  }
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function clearVocabularyEntries(): void {
  notifyAccountObjectsDeleted("vocabulary", getVocabularyEntries().map((entry) => entry.id));
  saveVocabularyEntries([]);
}
