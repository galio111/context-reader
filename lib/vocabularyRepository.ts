import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { normalizeAnkiInfo } from "@/lib/ankiData";
import LZString from "lz-string";
import type { VocabularyEntry } from "@/types/vocabulary";
import { notifyAccountDataChanged, notifyAccountObjectsDeleted } from "@/lib/accountEvents";
import { deduplicateVocabularyEntries } from "@/lib/vocabularyMerge";

const VOCABULARY_KEY = "context-reader:vocabulary:v1";
const VOCABULARY_PRE_DEDUPE_BACKUP_KEY = "context-reader:vocabulary-backup-before-dedupe:v1";
const COMPRESSED_VOCABULARY_PREFIX = "lz-utf16:";
const OWNER_KEY = "context-reader:local-account-owner:v1";

// The repository owns decoding and migration. Domain operations in vocabulary.ts
// keep their existing API and receive independent values, never this snapshot.
const snapshots = new WeakMap<Storage, { raw: string; owner: string | null; entries: VocabularyEntry[] }>();

function copyEntries(entries: VocabularyEntry[]): VocabularyEntry[] {
  return entries.map((entry) => ({
    ...entry,
    anki: { ...entry.anki },
    ...(entry.sourceArticle ? { sourceArticle: { ...entry.sourceArticle } } : {}),
  }));
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return getLearningStorage();
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
  const sourceArticle = entry.sourceArticle
    && entry.sourceArticle.kind === "public"
    && typeof entry.sourceArticle.id === "string"
    && entry.sourceArticle.id.trim()
      ? {
          kind: "public" as const,
          id: entry.sourceArticle.id.trim(),
          title: typeof entry.sourceArticle.title === "string" ? entry.sourceArticle.title : "",
        }
      : undefined;
  const normalizedBase = {
    id: typeof entry.id === "string" ? entry.id : `${entry.word.toLowerCase()}-${Date.now()}`,
    word: entry.word,
    lemma: typeof entry.lemma === "string" ? entry.lemma : entry.word,
    phonetic: typeof entry.phonetic === "string" ? entry.phonetic : "",
    phoneticFor: typeof entry.phoneticFor === "string" ? entry.phoneticFor : "",
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
    sourceArticle,
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
      snapshots.delete(storage);
      return [];
    }
    const owner = storage.getItem(OWNER_KEY);
    const snapshot = snapshots.get(storage);
    if (snapshot?.raw === raw && snapshot.owner === owner) return copyEntries(snapshot.entries);

    const compressed = raw.startsWith(COMPRESSED_VOCABULARY_PREFIX);
    const serialized = compressed
      ? LZString.decompressFromUTF16(raw.slice(COMPRESSED_VOCABULARY_PREFIX.length))
      : raw;
    if (!serialized) {
      snapshots.delete(storage);
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
    if ((!compressed && !isLearningStorage(storage)) || normalizedSerialized !== serialized) {
      saveVocabularyEntries(deduplicated.entries);
    }
    // Save/notification handlers can synchronously change the collection or its
    // owner. Only cache a snapshot whose bytes still describe these entries.
    const currentRaw = storage.getItem(VOCABULARY_KEY);
    const unchanged = currentRaw === raw && normalizedSerialized === serialized;
    const matches = unchanged || currentRaw === (isLearningStorage(storage)
      ? normalizedSerialized
      : `${COMPRESSED_VOCABULARY_PREFIX}${LZString.compressToUTF16(normalizedSerialized)}`);
    if (storage.getItem(OWNER_KEY) === owner && matches) {
      snapshots.set(storage, { raw: currentRaw!, owner, entries: copyEntries(deduplicated.entries) });
    }
    return deduplicated.entries;
  } catch {
    snapshots.delete(storage);
    return [];
  }
}

export function saveVocabularyEntries(entries: VocabularyEntry[]): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  snapshots.delete(storage);
  const serialized = JSON.stringify(entries);
  storage.setItem(
    VOCABULARY_KEY,
    isLearningStorage(storage) ? serialized : `${COMPRESSED_VOCABULARY_PREFIX}${LZString.compressToUTF16(serialized)}`,
  );
  notifyAccountDataChanged(["vocabulary"]);
}

