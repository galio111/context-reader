import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";

const VOCABULARY_KEY = "context-reader:vocabulary:v1";

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

  const normalizedBase = {
    id: typeof entry.id === "string" ? entry.id : `${entry.word.toLowerCase()}-${Date.now()}`,
    word: entry.word,
    lemma: typeof entry.lemma === "string" ? entry.lemma : entry.word,
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
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
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
    const entries = raw ? normalizeVocabularyEntries(JSON.parse(raw)) : [];
    saveVocabularyEntries(entries);
    return entries;
  } catch {
    return [];
  }
}

export function saveVocabularyEntries(entries: VocabularyEntry[]): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(VOCABULARY_KEY, JSON.stringify(entries));
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
  };

  return {
    ...base,
    anki: normalizeAnkiInfo({ ...explanation, anki: explanation.anki }, context.sentence),
  };
}

export function vocabularyIdentity(entry: Pick<VocabularyEntry, "word" | "sourceSentence">): string {
  return `${entry.word.trim().toLowerCase()}::${entry.sourceSentence.trim().toLowerCase()}`;
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
  const nextEntries = getVocabularyEntries().map((entry) =>
    entry.id === updatedEntry.id ? updatedEntry : entry,
  );
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function markVocabularyEntryImported(id: string, ankiNoteId: number): VocabularyEntry[] {
  const nextEntries = getVocabularyEntries().map((entry) =>
    entry.id === id
      ? {
          ...entry,
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
  const nextEntries = getVocabularyEntries().filter((entry) => entry.id !== id);
  saveVocabularyEntries(nextEntries);
  return nextEntries;
}

export function clearVocabularyEntries(): void {
  saveVocabularyEntries([]);
}
