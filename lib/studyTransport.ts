import { planProgress } from "@/lib/studyScheduler";
import type { StudySnapshot } from "@/types/study";
import type { VocabularyEntry } from "@/types/vocabulary";

export const STUDY_COMPACT_FORMAT = "compact-v1";
export const STUDY_INLINE_ENTRY_COUNT = 8;
export type StudyEntrySummary = Pick<VocabularyEntry, "id" | "word" | "basicMeaning" | "contextMeaning" | "createdAt" | "updatedAt"> & { studySummary: true };

/** Summary defaults are compatibility fields, never a saved full explanation. */
export function isStudyEntrySummary(entry: VocabularyEntry | undefined): boolean {
  return Boolean(entry && (entry as VocabularyEntry & { studySummary?: boolean }).studySummary === true);
}

function isSnapshot(value: unknown): value is StudySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<StudySnapshot>;
  return typeof snapshot.serverNow === "string" && Array.isArray(snapshot.cards) && Array.isArray(snapshot.entries);
}

function mapSnapshots<T>(data: T, map: (snapshot: StudySnapshot) => StudySnapshot): T {
  if (isSnapshot(data)) return map(data) as T;
  if (data && typeof data === "object" && "snapshot" in data && isSnapshot(data.snapshot)) {
    const snapshot = map(data.snapshot);
    return snapshot === data.snapshot ? data : { ...data, snapshot };
  }
  return data;
}

/** Keep scheduling/ledger state exact; send full content for the first ready cards. */
export function compactStudyResponse<T>(data: T): T {
  return mapSnapshots(data, snapshot => {
    const inline = new Set(planProgress(snapshot.cards, snapshot.today?.card_ids ?? [], new Date(snapshot.serverNow), snapshot.today?.new_ids)
      .ready.slice(0, STUDY_INLINE_ENTRY_COUNT).map(card => card.entry_id));
    return { ...snapshot, entries: snapshot.entries.map(entry => {
      if (inline.has(entry.id)) {
        // A saved dictionary is available from the single-entry endpoint.
        const { dictionaryResult: _dictionary, ...full } = entry;
        void _dictionary;
        return full;
      }
      const { id, word, basicMeaning, contextMeaning, createdAt, updatedAt } = entry;
      const summary: StudyEntrySummary = { id, word, basicMeaning, contextMeaning, createdAt, updatedAt, studySummary: true };
      // Only the wire representation is partial; clients hydrate before domain use.
      return summary as unknown as VocabularyEntry;
    }) };
  });
}

function hydrateSummary(summary: StudyEntrySummary): VocabularyEntry {
  return {
    lemma: summary.word, phonetic: "", phoneticFor: "", partOfSpeech: "", sentenceTranslation: "",
    usageNote: "", collocation: "", exampleEnglish: "", exampleChinese: "", sourceSentence: "",
    previousSentence: "", nextSentence: "", difficulty: "medium", shouldAddToVocabulary: true,
    anki: { canMakeCloze: false, cardMode: "basic_en_to_cn", clozeSentence: "", contextCue: "", basicCue: "", frontPreview: "", backPreview: "" },
    ...summary,
  };
}

/** Accept compact direct/nested responses as well as older full server responses. */
export function hydrateStudyResponse<T>(data: T): T {
  return mapSnapshots(data, snapshot => {
    if (!snapshot.entries.some(isStudyEntrySummary)) return snapshot;
    return { ...snapshot, entries: snapshot.entries.map(entry => isStudyEntrySummary(entry)
      ? hydrateSummary(entry as VocabularyEntry & StudyEntrySummary) : entry) };
  });
}
