import type { DictionaryResult } from "@/types/dictionary";

type DictionaryStreamEvent =
  | { type: "head"; query?: string; lemma?: string; phonetic?: string }
  | { type: "sense"; partOfSpeech?: string; meaning?: string; register?: string; exampleEnglish?: string; exampleChinese?: string }
  | { type: "usage"; value?: string }
  | { type: "collocation"; phrase?: string; meaning?: string; exampleEnglish?: string }
  | { type: "wordFamily"; word?: string; partOfSpeech?: string; meaning?: string }
  | { type: "synonym"; word?: string; difference?: string }
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
    senses: [],
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
        result.query = clean(event.query) || fallbackQuery;
        result.lemma = clean(event.lemma) || result.query;
        result.phonetic = clean(event.phonetic);
        break;
      case "sense": {
        const meaning = clean(event.meaning);
        if (!meaning || result.senses.length >= 4) break;
        result.senses.push({
          partOfSpeech: clean(event.partOfSpeech) || "词性待确认",
          meaning,
          register: clean(event.register) || "常用",
          exampleEnglish: clean(event.exampleEnglish),
          exampleChinese: clean(event.exampleChinese),
        });
        break;
      }
      case "usage":
        result.usageGuide = clean(event.value);
        break;
      case "collocation": {
        const phrase = clean(event.phrase);
        if (!phrase || result.collocations.length >= 6) break;
        result.collocations.push({
          phrase,
          meaning: clean(event.meaning),
          exampleEnglish: clean(event.exampleEnglish),
        });
        break;
      }
      case "wordFamily": {
        const word = clean(event.word);
        if (!word || result.wordFamily.length >= 5) break;
        result.wordFamily.push({ word, partOfSpeech: clean(event.partOfSpeech), meaning: clean(event.meaning) });
        break;
      }
      case "synonym": {
        const word = clean(event.word);
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

  return { result, complete, eventCount };
}

export function isCompleteDictionaryResult(parsed: ParsedDictionaryStream): boolean {
  return parsed.complete && parsed.result.senses.length > 0 && Boolean(parsed.result.query.trim());
}
