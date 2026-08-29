import type { DictionaryResult } from "@/types/dictionary";
import { normalizeDictionarySpelling } from "@/lib/dictionarySpelling";
import { pronunciationTargetMatches } from "@/lib/pronunciation";

type DictionaryStreamEvent =
  | {
    type: "head";
    query?: string;
    lemma?: string;
    phonetic?: string;
    phoneticFor?: string;
    direction?: "en_to_cn" | "cn_to_en";
    inputStatus?: "valid" | "inflection" | "ambiguous" | "misspelled";
    suggestedQuery?: string;
  }
  | { type: "sense"; headword?: string; headwordNote?: string; partOfSpeech?: string; meaning?: string; phonetic?: string; register?: string; usageNote?: string; exampleEnglish?: string; exampleChinese?: string }
  | { type: "verbForms"; pastTense?: string; pastParticiple?: string; presentParticiple?: string }
  | { type: "usage"; value?: string }
  | { type: "collocation"; phrase?: string; meaning?: string; exampleEnglish?: string; value?: string }
  | { type: "wordFamily"; word?: string; partOfSpeech?: string; meaning?: string; value?: string }
  | { type: "synonym"; word?: string; difference?: string; value?: string }
  | { type: "mistake"; value?: string }
  | { type: "memory"; value?: string }
  | { type: "done" };

export interface ParsedDictionaryStream {
  result: DictionaryResult;
  complete: boolean;
  eventCount: number;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseEvent(line: string): DictionaryStreamEvent | null {
  const candidate = line.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    const value = JSON.parse(candidate) as { type?: unknown };
    return typeof value.type === "string" ? value as DictionaryStreamEvent : null;
  } catch {
    return null;
  }
}

export function parseDictionaryStream(text: string, fallbackQuery: string): ParsedDictionaryStream {
  const result: DictionaryResult = {
    query: fallbackQuery,
    lemma: fallbackQuery,
    phonetic: "",
    phoneticFor: "",
    direction: /[\u3400-\u9fff\uf900-\ufaff]/u.test(fallbackQuery) ? "cn_to_en" : "en_to_cn",
    inputStatus: "valid",
    suggestedQuery: "",
    senses: [],
    verbForms: null,
    usageGuide: "",
    collocations: [],
    wordFamily: [],
    synonyms: [],
    commonMistakes: [],
    memoryTip: "",
  };
  let complete = false;
  let eventCount = 0;

  for (const line of text.split(/\r?\n/)) {
    const event = parseEvent(line);
    if (!event) continue;
    eventCount += 1;
    switch (event.type) {
      case "head":
        result.query = fallbackQuery;
        result.lemma = clean(event.lemma) || result.query;
        result.phonetic = pronunciationTargetMatches(clean(event.phoneticFor), fallbackQuery)
          ? clean(event.phonetic)
          : "";
        result.phoneticFor = result.phonetic ? fallbackQuery : "";
        result.direction = /[\u3400-\u9fff\uf900-\ufaff]/u.test(fallbackQuery)
          ? "cn_to_en"
          : "en_to_cn";
        result.inputStatus =
          event.inputStatus === "inflection" || event.inputStatus === "ambiguous" || event.inputStatus === "misspelled"
            ? event.inputStatus
            : "valid";
        result.suggestedQuery = clean(event.suggestedQuery);
        break;
      case "sense": {
        const meaning = clean(event.meaning);
        if (!meaning || result.senses.length >= 8) break;
        result.senses.push({
          headword: clean(event.headword),
          headwordNote: clean(event.headwordNote),
          partOfSpeech: clean(event.partOfSpeech) || "词性待确认",
          meaning,
          phonetic: clean(event.phonetic),
          register: clean(event.register) || "常用",
          usageNote: clean(event.usageNote),
          exampleEnglish: clean(event.exampleEnglish),
          exampleChinese: clean(event.exampleChinese),
        });
        if (result.direction === "cn_to_en" && result.senses.length === 1) {
          result.lemma = meaning;
          result.phonetic = clean(event.phonetic) || result.phonetic;
          result.phoneticFor = result.phonetic ? meaning : "";
        }
        break;
      }
      case "usage":
        result.usageGuide = clean(event.value);
        break;
      case "verbForms":
        result.verbForms = {
          pastTense: clean(event.pastTense),
          pastParticiple: clean(event.pastParticiple),
          presentParticiple: clean(event.presentParticiple),
        };
        break;
      case "collocation": {
        const phrase = clean(event.phrase) || clean(event.value);
        if (!phrase || result.collocations.length >= 6) break;
        result.collocations.push({
          phrase,
          meaning: clean(event.meaning),
          exampleEnglish: clean(event.exampleEnglish),
        });
        break;
      }
      case "wordFamily": {
        const word = clean(event.word) || clean(event.value);
        if (!word || result.wordFamily.length >= 5) break;
        result.wordFamily.push({ word, partOfSpeech: clean(event.partOfSpeech), meaning: clean(event.meaning) });
        break;
      }
      case "synonym": {
        const word = clean(event.word) || clean(event.value);
        if (!word || result.synonyms.length >= 5) break;
        result.synonyms.push({ word, difference: clean(event.difference) });
        break;
      }
      case "mistake": {
        const value = clean(event.value);
        if (value && result.commonMistakes.length < 4) result.commonMistakes.push(value);
        break;
      }
      case "memory":
        result.memoryTip = clean(event.value);
        break;
      case "done":
        complete = true;
        break;
    }
  }

  return { result: normalizeDictionarySpelling(result, fallbackQuery), complete, eventCount };
}

export function isCompleteDictionaryResult(parsed: ParsedDictionaryStream): boolean {
  if (!parsed.result.query.trim()) return false;
  if (parsed.result.inputStatus === "misspelled") {
    return Boolean(parsed.result.suggestedQuery.trim()) && parsed.eventCount > 0;
  }
  return parsed.complete && parsed.result.senses.length > 0;
}
