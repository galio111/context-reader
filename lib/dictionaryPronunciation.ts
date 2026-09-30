import type { DictionaryResult } from "../types/dictionary";
import type { PronunciationAccent } from "./pronunciation";

type Entry = NonNullable<DictionaryResult["pronunciations"]>[number];
export interface DictionaryPronunciationGroup {
  parts: Entry["partOfSpeech"][];
  entries: Entry[];
}

// Normalize transcription conventions, never actual accent or stress differences.
export function phoneticComparisonKey(value: string): string {
  return value.normalize("NFC").replace(/[\/\[\]\s.·]/g, "")
    .replace(/['’]/g, "ˈ").replace(/:/g, "ː")
    .replace(/ɡ/g, "g").replace(/ɹ/g, "r").replace(/ɛ/g, "e")
    .replace(/ɚ/g, "ər").replace(/ɝ/g, "ɜːr");
}

export function groupDictionaryPronunciations(entries: Entry[] = []): DictionaryPronunciationGroup[] {
  const byPart = new Map<Entry["partOfSpeech"], Entry[]>();
  for (const entry of entries) {
    if (!entry.phonetic.trim()) continue;
    const items = byPart.get(entry.partOfSpeech) ?? [];
    if (!items.some(item => item.accent === entry.accent
      && phoneticComparisonKey(item.phonetic) === phoneticComparisonKey(entry.phonetic))) items.push(entry);
    byPart.set(entry.partOfSpeech, items);
  }
  const groups: DictionaryPronunciationGroup[] = [];
  for (const [part, items] of byPart) {
    const compatible = groups.find(group => {
      let shared = false;
      for (const accent of ["en-US", "en-GB"] as const) {
        const a = group.entries.filter(item => item.accent === accent).map(item => phoneticComparisonKey(item.phonetic)).sort();
        const b = items.filter(item => item.accent === accent).map(item => phoneticComparisonKey(item.phonetic)).sort();
        if (a.length && b.length) {
          if (a.join("|") !== b.join("|")) return false;
          shared = true;
        }
      }
      return shared;
    });
    if (compatible) {
      compatible.parts.push(part);
      for (const item of items) if (!compatible.entries.some(entry => entry.accent === item.accent
        && phoneticComparisonKey(entry.phonetic) === phoneticComparisonKey(item.phonetic))) compatible.entries.push(item);
    } else groups.push({ parts: [part], entries: [...items] });
  }
  return groups;
}

export function dictionaryPronunciationRows(group: DictionaryPronunciationGroup): Array<{
  phonetic: string;
  accents: PronunciationAccent[];
  phonetics: Partial<Record<PronunciationAccent, string>>;
}> {
  const rows: ReturnType<typeof dictionaryPronunciationRows> = [];
  for (const entry of [...group.entries].sort((a, b) => a.accent === b.accent ? 0 : a.accent === "en-US" ? -1 : 1)) {
    const shared = rows.find(row => phoneticComparisonKey(row.phonetic) === phoneticComparisonKey(entry.phonetic));
    if (shared) {
      if (!shared.accents.includes(entry.accent)) shared.accents.push(entry.accent);
      shared.phonetics[entry.accent] = entry.phonetic;
    } else rows.push({ phonetic: entry.phonetic, accents: [entry.accent], phonetics: { [entry.accent]: entry.phonetic } });
  }
  return rows;
}

// Reviewed lexical corrections apply to old cached results as well as new streams.
// https://www.oxfordlearnersdictionaries.com/definition/english/plead
export function reviewedDictionaryPronunciations(query: string): Entry[] | null {
  const ipa = ({ plead: "/pliːd/", pled: "/pled/" } as Record<string, string>)[query.trim().toLowerCase()];
  return ipa ? [
    { accent: "en-US", partOfSpeech: "verb", phonetic: ipa },
    { accent: "en-GB", partOfSpeech: "verb", phonetic: ipa },
  ] : null;
}
