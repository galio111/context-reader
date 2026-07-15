import { normalizeAnkiInfo } from "@/lib/ankiData";
import { findSimilarVocabularyEntry, vocabularyWordsMatch } from "@/lib/sourceMatching";
import LZString from "lz-string";
import type { WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";
import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";
import { deduplicateVocabularyEntries, vocabularyIdentity } from "@/lib/vocabularyMerge";

export { vocabularyIdentity } from "@/lib/vocabularyMerge";

const VOCABULARY_KEY = "context-reader:vocabulary:v1";
const VOCABULARY_PRE_DEDUPE_BACKUP_KEY = "context-reader:vocabulary-backup-before-dedupe:v1";
const COMPRESSED_VOCABULARY_PREFIX = "lz-utf16:";

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const testKey = "context-reader:storage-test";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeVocabularyEntry(value: unknown): VocabularyEntry | null {
  const entry = value as Partial<VocabularyEntry>;
  if (!entry || typeof entry.word !== "string" || typeof entry.sourceSentence !== "string") {
    return null;
  }

  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString();
  const normalizedBase = {
    id: typeof entry.id === "string" ? entry.id : `${entry.word.toLowerCase()}-${Date.now()}`,
    word: entry.word,
    lemma: typeof entry.lemma === "string" ? entry.lemma : entry.word,
    phonetic: typeof entry.phonetic === "string" ? entry.phonetic : "",
    partOfSpeech: typeof entry.partOfSpeech === "string" ? entry.partOfSpeech : "",
    basicMeaning: typeof entry.basicMeaning === "string" ? entry.basicMeaning : "",
    contextMeaning: typeof entry.contextMeaning === "string" ? entry.contextMeaning : "",
    sentenceTranslation:
      typeof entry.sentenceTranslation === "string" ? entry.sentenceTranslation : "",
    usageNote: typeof entry.usageNote === "string" ? entry.usageNote : "",
    collocation: typeof entry.collocation === "string" ? entry.collocation : "",
    exampleEnglish: typeof entry.exampleEnglish === "string" ? entry.exampleEnglish : "",
    exampleChinese: typeof entry.exampleChinese === "string" ? entry.exampleChinese : "",
    sourceSentence: entry.sourceSentence,
    previousSentence: typeof entry.previousSentence === "string" ? entry.previousSentence : "",
    nextSentence: typeof entry.nextSentence === "string" ? entry.nextSentence : "",
    difficulty: ["easy", "medium", "hard"].includes(String(entry.difficulty))
      ? entry.difficulty!
      : "medium",
    shouldAddToVocabulary:
      typeof entry.shouldAddToVocabulary === "boolean" ? entry.shouldAddToVocabulary : true,
    createdAt,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : createdAt,
  };

  return {
    ...normalizedBase,
    anki: normalizeAnkiInfo(
      {
        ...normalizedBase,
        anki: entry.anki,
      },
      normalizedBase.sourceSentence,
    ),
  };
}

export function normalizeVocabularyEntries(entries: unknown): VocabularyEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map(normalizeVocabularyEntry).filter((entry): entry is VocabularyEntry => Boolean(entry));
}

export function getVocabularyEntries(): VocabularyEntry[] {
  const storage = safeLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(VOCABULARY_KEY);
    if (!raw) {
      return [];
    }

    const compressed = raw.startsWith(COMPRESSED_VOCABULARY_PREFIX);
    const serialized = compressed
      ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_VOCABULARY_PREFIX.length))
      : raw;
    if (!serialized) {
      return [];
    }

    const normalizedEntries = normalizeVocabularyEntries(JSON.parse(serialized));
    const deduplicated = deduplicateVocabularyEntries(normalizedEntries);
    const normalizedSerialized = JSON.stringify(deduplicated.entries);
    if (deduplicated.removedIds.length > 0) {
      if (!storage.getItem(VOCABULARY_PRE_DEDUPE_BACKUP_KEY)) {
        storage.setItem(VOCABULARY_PRE_DEDUPE_BACKUP_KEY, raw);
      }
      notifyAccountObjectsDeleted("vocabulary", deduplicated.removedIds);
    }
    if (!compressed || normalizedSerialized !== serialized) {
      saveVocabularyEntries(deduplicated.entries);
    }
    return deduplicated.entries;
  } catch {
    return [];
  }
}

export function saveVocabularyEntries(entries: VocabularyEntry[]): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  const serialized = JSON.stringify(entries);
  storage.setItem(
    VOCABULARY_KEY,
    `${COMPRESSED_VOCABULARY_PREFIX}${LZString.compressToUTF16(serialized)}`,
  );
  notifyAccountDataChanged();
}

export function createVocabularyEntry(
  explanation: WordExplanation,
  context: WordContext,
): VocabularyEntry {
  const createdAt = new Date().toISOString();
  const base = {
    id: `${explanation.word.toLowerCase()}-${Date.now()}`,
    word: explanation.word,
    lemma: explanation.lemma,
    phonetic: explanation.phonetic,
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
): VocabularyEntry[] {
  const entries = getVocabularyEntries();
  const identity = vocabularyIdentity({
    word: explanation.word,
    sourceSentence: context.sentence,
  });
  let replaced = false;

  const nextEntries = entries.map((entry) => {
    const isSameSource = vocabularyIdentity(entry) === identity;
    const isSimilarSource =
      !isSameSource &&
      vocabularyWordsMatch(entry.word, explanation.word) &&
      findSimilarVocabularyEntry([entry], explanation.word, context.sentence);

    if (!isSameSource && !isSimilarSource) {
      return entry;
    }

    replaced = true;
    const generated = createVocabularyEntry(explanation, context);
    return {
      ...generated,
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
      anki: {
        ...generated.anki,
        ankiNoteId: entry.anki.ankiNoteId,
        ankiImportedAt: entry.anki.ankiImportedAt,
      },
    };
  });

  if (replaced) {
    saveVocabularyEntries(nextEntries);
  }
  return nextEntries;
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
