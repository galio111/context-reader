import type { VocabularyEntry } from "@/types/vocabulary";

const RECOVERY_ID_PATTERN = /-local-recovered-[a-z0-9]+/gi;
const TEXT_FIELDS = [
  "word",
  "lemma",
  "phonetic",
  "phoneticFor",
  "partOfSpeech",
  "basicMeaning",
  "contextMeaning",
  "sentenceTranslation",
  "usageNote",
  "collocation",
  "exampleEnglish",
  "exampleChinese",
  "sourceSentence",
  "previousSentence",
  "nextSentence",
] as const satisfies ReadonlyArray<keyof VocabularyEntry>;

function normalizedIdentityPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parsedTime(value: string | undefined): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortVocabularyEntriesByCreatedAt(entries: VocabularyEntry[]): VocabularyEntry[] {
  return [...entries].sort((left, right) => {
    const createdDifference = parsedTime(right.createdAt) - parsedTime(left.createdAt);
    if (createdDifference !== 0) return createdDifference;
    const updatedDifference = parsedTime(right.updatedAt) - parsedTime(left.updatedAt);
    if (updatedDifference !== 0) return updatedDifference;
    return right.id.localeCompare(left.id);
  });
}

function recoveryDepth(id: string): number {
  return id.match(RECOVERY_ID_PATTERN)?.length ?? 0;
}

function contentScore(entry: VocabularyEntry): number {
  return TEXT_FIELDS.reduce((score, field) => score + String(entry[field] ?? "").trim().length, 0)
    + (entry.anki.ankiNoteId ? 10_000 : 0);
}

function canonicalEntry(entries: VocabularyEntry[]): VocabularyEntry {
  return [...entries].sort((left, right) => {
    const recoveryDifference = recoveryDepth(left.id) - recoveryDepth(right.id);
    if (recoveryDifference !== 0) return recoveryDifference;
    const createdDifference = parsedTime(left.createdAt) - parsedTime(right.createdAt);
    if (createdDifference !== 0) return createdDifference;
    return left.id.localeCompare(right.id);
  })[0];
}

function freshestEntry(entries: VocabularyEntry[]): VocabularyEntry {
  return [...entries].sort((left, right) => {
    const updatedDifference = parsedTime(right.updatedAt || right.createdAt) - parsedTime(left.updatedAt || left.createdAt);
    if (updatedDifference !== 0) return updatedDifference;
    return contentScore(right) - contentScore(left);
  })[0];
}

function mergeVocabularyGroup(entries: VocabularyEntry[]): VocabularyEntry {
  const canonical = canonicalEntry(entries);
  const freshest = freshestEntry(entries);
  const richestFirst = [...entries].sort((left, right) => contentScore(right) - contentScore(left));
  const merged: VocabularyEntry = {
    ...freshest,
    id: canonical.id,
    createdAt: new Date(Math.min(...entries.map((entry) => parsedTime(entry.createdAt) || Date.now()))).toISOString(),
    updatedAt: new Date(Math.max(...entries.map((entry) => parsedTime(entry.updatedAt || entry.createdAt)))).toISOString(),
  };

  for (const field of TEXT_FIELDS) {
    if (String(merged[field] ?? "").trim()) continue;
    const fallback = richestFirst.find((entry) => String(entry[field] ?? "").trim());
    if (fallback) {
      (merged as unknown as Record<string, unknown>)[field] = fallback[field];
    }
  }

  if (!merged.sourceArticle) {
    merged.sourceArticle = richestFirst.find((entry) => entry.sourceArticle)?.sourceArticle;
  }

  const imported = richestFirst.find((entry) => Boolean(entry.anki.ankiNoteId));
  if (imported) {
    merged.anki = imported.anki;
  }
  return merged;
}

export function vocabularyIdentity(entry: Pick<VocabularyEntry, "word" | "sourceSentence">): string {
  return `${normalizedIdentityPart(entry.word)}::${normalizedIdentityPart(entry.sourceSentence)}`;
}

export function isRecoveredVocabularyId(id: string): boolean {
  return id.toLowerCase().includes("-local-recovered-");
}

export function mergeVocabularyEntryVersions(left: VocabularyEntry, right: VocabularyEntry): VocabularyEntry {
  if (vocabularyIdentity(left) !== vocabularyIdentity(right)) {
    return parsedTime(left.updatedAt || left.createdAt) > parsedTime(right.updatedAt || right.createdAt)
      ? left
      : right;
  }
  return mergeVocabularyGroup([left, right]);
}

export function deduplicateVocabularyEntries(entries: VocabularyEntry[]): {
  entries: VocabularyEntry[];
  removedIds: string[];
} {
  const groups = new Map<string, VocabularyEntry[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const identity = vocabularyIdentity(entry);
    const group = groups.get(identity);
    if (group) {
      group.push(entry);
    } else {
      groups.set(identity, [entry]);
      order.push(identity);
    }
  }

  const removedIds = new Set<string>();
  const deduplicated = order.map((identity) => {
    const group = groups.get(identity)!;
    const merged = mergeVocabularyGroup(group);
    for (const entry of group) {
      if (entry.id !== merged.id) removedIds.add(entry.id);
    }
    return merged;
  });
  return {
    entries: sortVocabularyEntriesByCreatedAt(deduplicated),
    removedIds: Array.from(removedIds),
  };
}
