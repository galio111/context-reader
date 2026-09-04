import { normalizeDifficultyLabel, normalizePartOfSpeechLabel } from "@/lib/displayLabels";
import { normalizeAnkiInfo } from "@/lib/ankiData";
import { currentFormPhonetic, requiresCurrentFormPhonetic } from "@/lib/pronunciation";
import type { Difficulty, WordContext, WordExplanation } from "@/types/reader";

export interface ExplanationDisplaySection {
  label: string;
  value: string;
}

const FIELD_LABELS = {
  lemma: ["原型", "原形", "词元", "lemma", "Lemma"],
  phonetic: ["当前词音标", "音标", "phonetic", "Phonetic"],
  phoneticFor: ["当前词音标归属", "音标归属", "phoneticFor"],
  partOfSpeech: ["词性", "partOfSpeech"],
  difficulty: ["难度", "difficulty"],
  basicMeaning: ["基础释义"],
  contextMeaning: ["当前语境含义"],
  sentenceTranslation: ["当前句子翻译"],
  usageNote: ["用法说明"],
  collocation: ["常见搭配"],
  exampleEnglish: ["英文例句"],
  exampleChinese: ["例句中文翻译"],
} as const;

const CANONICAL_LABELS = new Map<string, string>(
  Object.values(FIELD_LABELS).flatMap((labels) =>
    labels.map((label) => [label, labels[0]] as const),
  ),
);

export function parseExplanationStream(streamText: string): ExplanationDisplaySection[] {
  const sections: ExplanationDisplaySection[] = [];
  const lines = streamText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([^:：]{2,18})[:：]\s*(.*)$/);
    if (match) {
      const canonicalLabel = CANONICAL_LABELS.get(match[1].trim());
      if (!canonicalLabel) {
        continue;
      }
      const existing = sections.find((section) => section.label === canonicalLabel);
      if (existing) {
        existing.value = match[2] ?? "";
      } else {
        sections.push({ label: canonicalLabel, value: match[2] ?? "" });
      }
      continue;
    }

    const last = sections[sections.length - 1];
    if (last) {
      last.value = `${last.value}${last.value ? "\n" : ""}${line}`;
    }
  }

  return sections;
}

export function explanationStreamValue(
  sections: ExplanationDisplaySection[],
  labels: readonly string[],
): string {
  return sections.find((section) => labels.includes(section.label.trim()))?.value.trim() ?? "";
}

function streamField(
  sections: ExplanationDisplaySection[],
  field: keyof typeof FIELD_LABELS,
): string {
  return explanationStreamValue(sections, FIELD_LABELS[field]);
}

function difficultyFromDisplay(value: string, fallback: Difficulty): Difficulty {
  const label = normalizeDifficultyLabel(value);
  if (label === "基础") return "easy";
  if (label === "高阶") return "hard";
  if (label === "进阶") return "medium";
  return fallback;
}

export function mergeStreamDisplayIntoExplanation(
  explanation: WordExplanation,
  streamText: string,
): WordExplanation {
  const sections = parseExplanationStream(streamText);
  const basicMeaning = streamField(sections, "basicMeaning");
  const contextMeaning = streamField(sections, "contextMeaning");
  const sentenceTranslation = streamField(sections, "sentenceTranslation");

  if (!basicMeaning || !contextMeaning || !sentenceTranslation) {
    return explanation;
  }

  const partOfSpeech = streamField(sections, "partOfSpeech");
  const streamLemma = streamField(sections, "lemma") || explanation.lemma;
  const streamPhoneticFor = streamField(sections, "phoneticFor");
  const streamPhonetic = currentFormPhonetic({
    word: explanation.word,
    lemma: streamLemma,
    phonetic: streamField(sections, "phonetic"),
    phoneticFor: streamPhoneticFor,
  });
  return {
    ...explanation,
    lemma: streamLemma,
    phonetic: streamPhonetic || explanation.phonetic,
    phoneticFor: streamPhonetic ? explanation.word : explanation.phoneticFor,
    partOfSpeech: partOfSpeech
      ? normalizePartOfSpeechLabel(partOfSpeech)
      : explanation.partOfSpeech,
    difficulty: difficultyFromDisplay(
      streamField(sections, "difficulty"),
      explanation.difficulty,
    ),
    basicMeaning,
    contextMeaning,
    sentenceTranslation,
    usageNote: streamField(sections, "usageNote") || explanation.usageNote,
    collocation: streamField(sections, "collocation") || explanation.collocation,
    exampleEnglish: streamField(sections, "exampleEnglish") || explanation.exampleEnglish,
    exampleChinese: streamField(sections, "exampleChinese") || explanation.exampleChinese,
  };
}

export function explanationFromCompletedStream(
  streamText: string,
  context: WordContext,
): WordExplanation | null {
  const sections = parseExplanationStream(streamText);
  const partOfSpeech = streamField(sections, "partOfSpeech");
  const difficulty = streamField(sections, "difficulty");
  const basicMeaning = streamField(sections, "basicMeaning");
  const contextMeaning = streamField(sections, "contextMeaning");
  const sentenceTranslation = streamField(sections, "sentenceTranslation");
  const usageNote = streamField(sections, "usageNote");
  const collocation = streamField(sections, "collocation");
  const exampleEnglish = streamField(sections, "exampleEnglish");
  const exampleChinese = streamField(sections, "exampleChinese");
  const lemma = context.word.trim().split(/\s+/).length > 1
    ? ""
    : streamField(sections, "lemma") || context.word;
  const phonetic = currentFormPhonetic({
    word: context.word,
    lemma,
    phonetic: streamField(sections, "phonetic"),
    phoneticFor: streamField(sections, "phoneticFor"),
  });

  // The last required field is the completion boundary promised by the stream.
  // A truncated or malformed response must not enable save/copy actions.
  if (
    !partOfSpeech
    || !difficulty
    || !basicMeaning
    || !contextMeaning
    || !sentenceTranslation
    || !usageNote
    || !collocation
    || !exampleEnglish
    || !exampleChinese
    || (requiresCurrentFormPhonetic(context.word) && !phonetic)
  ) {
    return null;
  }

  const explanationWithoutAnki = {
    word: context.word,
    lemma,
    phonetic,
    phoneticFor: phonetic ? context.word : "",
    partOfSpeech: normalizePartOfSpeechLabel(partOfSpeech),
    difficulty: difficultyFromDisplay(difficulty, "medium"),
    basicMeaning,
    contextMeaning,
    sentenceTranslation,
    usageNote,
    collocation,
    exampleEnglish,
    exampleChinese,
    shouldAddToVocabulary: true,
  };

  return {
    ...explanationWithoutAnki,
    anki: normalizeAnkiInfo(explanationWithoutAnki, context.sentence),
  };
}

export function explanationAsStreamText(explanation: WordExplanation): string {
  return [
    `原型：${explanation.lemma}`,
    `当前词音标：${explanation.phonetic}`,
    `当前词音标归属：${explanation.phoneticFor || ""}`,
    `词性：${explanation.partOfSpeech}`,
    `难度：${normalizeDifficultyLabel(explanation.difficulty)}`,
    `基础释义：${explanation.basicMeaning}`,
    `当前语境含义：${explanation.contextMeaning}`,
    `当前句子翻译：${explanation.sentenceTranslation}`,
    `用法说明：${explanation.usageNote}`,
    `常见搭配：${explanation.collocation || "无固定搭配"}`,
    `英文例句：${explanation.exampleEnglish}`,
    `例句中文翻译：${explanation.exampleChinese}`,
  ].join("\n");
}
