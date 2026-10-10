import type { DictionaryResult } from "../types/dictionary";
import type { PronunciationAccent } from "./pronunciation";

type Entry = NonNullable<DictionaryResult["pronunciations"]>[number];
export interface DictionaryPronunciationGroup {
  parts: Entry["partOfSpeech"][];
  meanings: string[];
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
  const variants: Entry[][] = [];
  for (const entry of entries) {
    if (!entry.phonetic.trim()) continue;
    const key = phoneticComparisonKey(entry.phonetic);
    const candidates = variants.filter(items => items[0].partOfSpeech === entry.partOfSpeech
      && (items[0].meaning || "") === (entry.meaning || "")
      && !items.some(item => item.accent === entry.accent && phoneticComparisonKey(item.phonetic) !== key));
    // A part of speech can contain several readings (bass/bow/lead). Prefer
    // equal IPA when matching legacy entries that lack a meaning label.
    const items = candidates.find(items => items.some(item => phoneticComparisonKey(item.phonetic) === key)) ?? candidates[0];
    if (!items) variants.push([entry]);
    else if (!items.some(item => item.accent === entry.accent)) items.push(entry);
  }
  const groups: DictionaryPronunciationGroup[] = [];
  for (const items of variants) {
    const part = items[0].partOfSpeech;
    const meaning = items[0].meaning?.trim();
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
      if (!compatible.parts.includes(part)) compatible.parts.push(part);
      if (meaning && !compatible.meanings.includes(meaning)) compatible.meanings.push(meaning);
      for (const item of items) if (!compatible.entries.some(entry => entry.accent === item.accent
        && phoneticComparisonKey(entry.phonetic) === phoneticComparisonKey(item.phonetic))) compatible.entries.push(item);
    } else groups.push({ parts: [part], meanings: meaning ? [meaning] : [], entries: [...items] });
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
  // https://dictionary.cambridge.org/dictionary/english/bass
  // Music is /beɪs/ for both noun and adjective; the fish is /bæs/.
  if (query.trim().toLowerCase() === "bass") return ([
    ["noun", "/beɪs/", "低音；贝斯"],
    ["adjective", "/beɪs/", "低音；贝斯"],
    ["noun", "/bæs/", "鲈鱼"],
  ] as const).flatMap(([partOfSpeech, phonetic, meaning]) =>
    (["en-US", "en-GB"] as const).map(accent => ({accent, partOfSpeech, phonetic, meaning})));
  // https://dictionary.cambridge.org/us/pronunciation/english/alternate
  if (query.trim().toLowerCase() === "alternate") return [
    { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈɑːltɝːnət/" },
    { accent: "en-GB", partOfSpeech: "noun", phonetic: "/ˈɒltənət/" },
    { accent: "en-US", partOfSpeech: "adjective", phonetic: "/ˈɑːltɝːnət/" },
    { accent: "en-GB", partOfSpeech: "adjective", phonetic: "/ɒlˈtɜːnət/" },
    { accent: "en-US", partOfSpeech: "verb", phonetic: "/ˈɑːltɚneɪt/" },
    { accent: "en-GB", partOfSpeech: "verb", phonetic: "/ˈɒltəneɪt/" },
  ];
  // https://dictionary.cambridge.org/pronunciation/english/burglary
  // https://dictionary.cambridge.org/pronunciation/english/tertiary
  const reviewed: Record<string, { partOfSpeech: Entry["partOfSpeech"]; us: string; uk: string }> = {
    // Learner-facing defaults; Collins also records US /ˈliːvər/ for lever
    // and /əˈstiːm/ for esteem. These are variants, not lexical errors.
    // https://www.collinsdictionary.com/us/dictionary/english-pronunciations/lever
    // https://dictionary.cambridge.org/pronunciation/english/esteem
    // https://www.collinsdictionary.com/us/dictionary/english/esteem
    lever: { partOfSpeech: "other", us: "/ˈlevər/", uk: "/ˈliːvə/" },
    esteem: { partOfSpeech: "other", us: "/ɪˈstiːm/", uk: "/ɪˈstiːm/" },
    // https://dictionary.cambridge.org/pronunciation/english/contemplate
    contemplate: { partOfSpeech: "verb", us: "/ˈkɑːntəmpleɪt/", uk: "/ˈkɒntəmpleɪt/" },
    burglary: { partOfSpeech: "noun", us: "/ˈbɝːɡlɚi/", uk: "/ˈbɜːɡləri/" },
    tertiary: { partOfSpeech: "adjective", us: "/ˈtɝːʃieri/", uk: "/ˈtɜːʃəri/" },
  };
  const item = reviewed[query.trim().toLowerCase()];
  if (item) return [
    { accent: "en-US", partOfSpeech: item.partOfSpeech, phonetic: item.us },
    { accent: "en-GB", partOfSpeech: item.partOfSpeech, phonetic: item.uk },
  ];
  const ipa = ({ plead: "/pliːd/", pled: "/pled/" } as Record<string, string>)[query.trim().toLowerCase()];
  return ipa ? [
    { accent: "en-US", partOfSpeech: "verb", phonetic: ipa },
    { accent: "en-GB", partOfSpeech: "verb", phonetic: ipa },
  ] : null;
}

export function reviewedDictionarySenses(query: string, senses: DictionaryResult["senses"]): DictionaryResult["senses"] {
  if (query.trim().toLowerCase() !== "bass") return senses;
  return senses.map(sense => {
    // Classify the actual definition, never the potentially incorrect IPA or
    // POS in generated prose. This also repairs saved history without a lookup.
    const phonetic = /鱼/.test(sense.meaning) ? "/bæs/"
      : /低音|低沉|贝[斯司]/.test(sense.meaning) ? "/beɪs/" : "";
    if (!phonetic) return sense;
    return { ...sense, phonetic,
      headwordNote: sense.headwordNote?.replace(/\/[ˈˌa-zɑæɛɪː]+\//gu, phonetic) };
  });
}

// A reviewed correction to the provider's default word reading. Keep it
// centralized so dictionary, contextual lookup and Anki share one identity.
export function reviewedPronunciationAudioPhonetic(text: string, accent: PronunciationAccent): string {
  const word = text.trim().toLowerCase();
  // Preserve the user's accepted recordings when ordinary dictionary rows
  // return to the same unqualified request as Reader/vocabulary/Anki.
  if (accent === "en-US" && word === "peg") return "/peɡ/";
  if (accent === "en-US" && word === "humiliate") return "/hjuːˈmɪliˌeɪt/";
  if (accent === "en-US" && word === "faction") return "/ˈfækʃən/";
  if ((word === "lever" || word === "esteem") && accent === "en-US") {
    return reviewedDictionaryPronunciations(word)?.find(entry => entry.accent === accent)?.phonetic ?? "";
  }
  return word === "contemplate" && accent === "en-US" ? "/ˈkɑːntəmpleɪt/" : "";
}
