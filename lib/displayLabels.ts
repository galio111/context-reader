import type { Difficulty } from "@/types/reader";

const PART_OF_SPEECH_LABELS: Array<[RegExp, string]> = [
  [/\b(phrasal verb)\b|短语动词/i, "短语动词"],
  [/\b(noun|n\.?)\b|名词/i, "名词"],
  [/\b(verb|v\.?)\b|动词/i, "动词"],
  [/\b(adjective|adj\.?)\b|形容词/i, "形容词"],
  [/\b(adverb|adv\.?)\b|副词/i, "副词"],
  [/\b(preposition|prep\.?)\b|介词/i, "介词"],
  [/\b(conjunction|conj\.?)\b|连词/i, "连词"],
  [/\b(pronoun|pron\.?)\b|代词/i, "代词"],
  [/\b(determiner|det\.?|article)\b|冠词|限定词/i, "限定词"],
  [/\b(interjection|int\.?)\b|感叹词/i, "感叹词"],
  [/\b(phrase|phr\.?|idiom|expression)\b|短语|习语|表达/i, "短语"],
];

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "基础",
  medium: "进阶",
  hard: "高阶",
};

export function normalizePartOfSpeechLabel(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "词性待确认";
  }

  const normalizedParts = raw
    .split(/[、,;/|，；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => PART_OF_SPEECH_LABELS.find(([pattern]) => pattern.test(part))?.[1] ?? part)
    .filter((part, index, parts) => parts.indexOf(part) === index);

  return normalizedParts.join(" / ") || raw;
}

export function normalizeDifficultyLabel(value: string | Difficulty): string {
  const raw = value.trim().toLowerCase();
  if (raw === "easy" || raw === "基础" || raw === "初级" || raw === "a1" || raw === "a2") {
    return DIFFICULTY_LABELS.easy;
  }
  if (
    raw === "medium" ||
    raw === "中级" ||
    raw === "中高级" ||
    raw === "b1" ||
    raw === "b2" ||
    raw === "cet4" ||
    raw === "cet-4" ||
    raw === "cet6" ||
    raw === "cet-6" ||
    raw === "ielts" ||
    raw === "雅思"
  ) {
    return DIFFICULTY_LABELS.medium;
  }
  if (raw === "hard" || raw === "高级" || raw === "c1" || raw === "c2" || raw === "gre" || raw === "toefl" || raw === "托福") {
    return DIFFICULTY_LABELS.hard;
  }
  return DIFFICULTY_LABELS.medium;
}

export function originalFormLabel(lemma: string, fallback: string): string {
  return (lemma.trim() || fallback.trim().toLowerCase()).trim();
}
