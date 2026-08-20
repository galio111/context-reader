export type PronunciationAccent = "en-US" | "en-GB";

export const PRONUNCIATION_ACCENTS: PronunciationAccent[] = ["en-US", "en-GB"];
export const MAX_PRONUNCIATION_TEXT_LENGTH = 80;

const WORD_OR_PHRASE_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,7}$/;

export function normalizePronunciationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPronunciationTarget(value: string): string {
  return normalizePronunciationText(value).toLocaleLowerCase("en");
}

export function pronunciationTargetMatches(value: string, expected: string): boolean {
  const normalizedValue = normalizedPronunciationTarget(value);
  return Boolean(normalizedValue) && normalizedValue === normalizedPronunciationTarget(expected);
}

export function currentFormPhonetic({
  word,
  lemma,
  phonetic,
  phoneticFor,
}: {
  word: string;
  lemma: string;
  phonetic: string;
  phoneticFor?: string;
}): string {
  const normalizedPhonetic = phonetic.trim();
  if (!normalizedPhonetic) return "";

  if (phoneticFor?.trim()) {
    return pronunciationTargetMatches(phoneticFor, word) ? normalizedPhonetic : "";
  }

  // Older data did not record which word form the IPA described. Reuse it
  // only when the displayed word and lemma are the same form.
  return pronunciationTargetMatches(lemma, word) ? normalizedPhonetic : "";
}

export function isPronunciationAccent(value: unknown): value is PronunciationAccent {
  return value === "en-US" || value === "en-GB";
}

export function isValidPronunciationText(value: string): boolean {
  const normalized = normalizePronunciationText(value);
  return (
    normalized.length > 0
    && normalized.length <= MAX_PRONUNCIATION_TEXT_LENGTH
    && WORD_OR_PHRASE_PATTERN.test(normalized)
  );
}

export function pronunciationAccentLabel(accent: PronunciationAccent): string {
  return accent === "en-US" ? "美音" : "英音";
}
