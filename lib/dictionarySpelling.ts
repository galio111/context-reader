import { reviewedDictionaryPronunciations } from "./dictionaryPronunciation";
import type { DictionaryInputStatus, DictionaryResult } from "@/types/dictionary";

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("en");
}

function normalizePhoneticOwnership(result: DictionaryResult, query: string): Pick<DictionaryResult, "phonetic" | "phoneticFor"> {
  const phonetic = typeof result.phonetic === "string" ? result.phonetic.trim() : "";
  const phoneticFor = typeof result.phoneticFor === "string" ? result.phoneticFor.trim() : "";
  if (!phonetic || !phoneticFor) return { phonetic: "", phoneticFor: "" };
  return normalized(phoneticFor) === normalized(query)
    ? { phonetic, phoneticFor: query }
    : { phonetic: "", phoneticFor: "" };
}

function collapseRepeatedLetters(value: string): string {
  return value.replace(/([a-z])\1+/g, "$1");
}

function inferredRepeatedLetterCorrection(query: string, lemma: string): boolean {
  const normalizedQuery = normalized(query);
  const normalizedLemma = normalized(lemma);
  if (
    !normalizedQuery
    || !normalizedLemma
    || normalizedQuery === normalizedLemma
    || normalizedQuery.includes(" ")
    || normalizedLemma.includes(" ")
    || !/([a-z])\1{2,}/.test(normalizedQuery)
  ) {
    return false;
  }
  return collapseRepeatedLetters(normalizedQuery) === collapseRepeatedLetters(normalizedLemma);
}

export function normalizeDictionarySpelling(
  result: DictionaryResult,
  fallbackQuery = result.query,
): DictionaryResult {
  const query = result.query?.trim() || fallbackQuery.trim();
  const lemma = result.lemma?.trim() || query;
  const direction = result.direction === "cn_to_en" ? "cn_to_en" : "en_to_cn";
  const pronunciationTarget = direction === "cn_to_en" ? lemma : query;
  const pronunciation = normalizePhoneticOwnership(result, pronunciationTarget);
  const reviewed = direction === "en_to_cn" ? reviewedDictionaryPronunciations(query) : null;
  if (reviewed) { pronunciation.phonetic = reviewed[0].phonetic; pronunciation.phoneticFor = query; }
  const pronunciations = direction === "en_to_cn" && Array.isArray(result.pronunciations)
    ? result.pronunciations.slice(0, 10).filter((item) => item && (item.accent === "en-US" || item.accent === "en-GB")
      && ["noun", "verb", "adjective", "adverb", "other"].includes(item.partOfSpeech)
      && typeof item.phonetic === "string" && item.phonetic.trim().length > 0 && item.phonetic.length <= 100)
      .map((item) => ({ accent: item.accent, partOfSpeech: item.partOfSpeech, phonetic: item.phonetic.trim() })) : [];
  const senses = Array.isArray(result.senses)
    ? result.senses.map((sense) => ({
      ...sense,
      phonetic: typeof sense.phonetic === "string" ? sense.phonetic : "",
      usageNote: typeof sense.usageNote === "string" ? sense.usageNote : "",
    }))
    : [];
  const verbForms = result.verbForms && typeof result.verbForms === "object"
    ? {
      pastTense: typeof result.verbForms.pastTense === "string" ? result.verbForms.pastTense : "",
      pastParticiple: typeof result.verbForms.pastParticiple === "string" ? result.verbForms.pastParticiple : "",
      presentParticiple: typeof result.verbForms.presentParticiple === "string" ? result.verbForms.presentParticiple : "",
    }
    : null;
  if (direction === "cn_to_en") {
    return {
      ...result,
      query,
      lemma,
      ...pronunciation,
      pronunciations: [],
      direction,
      senses,
      verbForms: null,
      inputStatus: "valid",
      suggestedQuery: "",
    };
  }
  const rawStatus = result.inputStatus;
  const explicitStatus: DictionaryInputStatus | null =
    rawStatus === "valid" || rawStatus === "inflection" || rawStatus === "ambiguous" || rawStatus === "misspelled"
      ? rawStatus
      : null;
  const inferredMisspelling = inferredRepeatedLetterCorrection(query, lemma);
  const inputStatus: DictionaryInputStatus =
    inferredMisspelling && explicitStatus !== "inflection"
      ? "misspelled"
      : explicitStatus ?? "valid";
  const suggestionCandidate = inputStatus === "misspelled"
    ? result.suggestedQuery?.trim() || lemma
    : "";
  const suggestedQuery = normalized(suggestionCandidate) !== normalized(query)
    ? suggestionCandidate
    : "";
  return { ...result, query, lemma, ...pronunciation, pronunciations: inputStatus === "misspelled" ? [] : reviewed ?? pronunciations, direction, senses, verbForms, inputStatus, suggestedQuery };
}
