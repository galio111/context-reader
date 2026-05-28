import type { VocabularyEntry } from "@/types/vocabulary";

const CSV_FIELDS = [
  "Word",
  "Lemma",
  "PartOfSpeech",
  "CardMode",
  "ClozeSentence",
  "ContextCue",
  "BasicCue",
  "BasicMeaning",
  "ContextMeaning",
  "SourceSentence",
  "SentenceTranslation",
  "UsageNote",
  "Collocation",
  "ExampleEnglish",
  "ExampleChinese",
  "Difficulty",
  "CreatedAt",
] as const;

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rowForEntry(entry: VocabularyEntry): Record<(typeof CSV_FIELDS)[number], string> {
  return {
    Word: entry.word,
    Lemma: entry.lemma,
    PartOfSpeech: entry.partOfSpeech,
    CardMode: entry.anki.cardMode,
    ClozeSentence: entry.anki.cardMode === "cloze_context" ? entry.anki.clozeSentence : "",
    ContextCue: entry.anki.cardMode === "cloze_context" ? entry.anki.contextCue : "",
    BasicCue: entry.anki.basicCue || entry.basicMeaning,
    BasicMeaning: entry.basicMeaning,
    ContextMeaning: entry.contextMeaning,
    SourceSentence: entry.sourceSentence,
    SentenceTranslation: entry.sentenceTranslation,
    UsageNote: entry.usageNote,
    Collocation: entry.collocation,
    ExampleEnglish: entry.exampleEnglish,
    ExampleChinese: entry.exampleChinese,
    Difficulty: entry.difficulty,
    CreatedAt: entry.createdAt,
  };
}

export function exportVocabularyCsv(entries: VocabularyEntry[]): string {
  const header = CSV_FIELDS.join(",");
  const rows = entries.map((entry) => {
    const row = rowForEntry(entry);
    return CSV_FIELDS.map((field) => escapeCsv(row[field] ?? "")).join(",");
  });
  return [header, ...rows].join("\r\n");
}

export function downloadVocabularyCsv(entries: VocabularyEntry[]): void {
  try {
    const csv = exportVocabularyCsv(entries);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `context-reader-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "CSV 导出失败，请稍后重试。");
  }
}
