import type { AnkiCardInfo, AnkiCardMode } from "@/types/anki";
import type { WordExplanation } from "@/types/reader";

function firstMeaning(value: string): string {
  return value
    .split(/[。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("；")
    .slice(0, 80);
}

function buildChineseCue(data: Partial<WordExplanation>): string {
  return String(data.contextMeaning ?? "").trim();
}

function buildLocalCloze(sentence: string, word: string): string {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!sentence.trim() || !escaped) {
    return "";
  }
  const clozeSentence = sentence.replace(new RegExp(`\\b${escaped}\\b`, "i"), "________");
  const remainingContext = clozeSentence
    .replace("________", "")
    .replace(/[^A-Za-z0-9]+/g, "");
  return clozeSentence !== sentence && remainingContext ? clozeSentence : "";
}

function buildFrontPreview(info: {
  cardMode: AnkiCardMode;
  clozeSentence: string;
  contextCue: string;
  basicCue: string;
  word: string;
}): string {
  if (info.cardMode === "cloze_context") {
    return [info.clozeSentence, info.contextCue].filter(Boolean).join("\n\n\n\n");
  }
  if (info.cardMode === "basic_en_to_cn") return info.word;
  if (info.cardMode === "basic_cn_to_en_dictionary") {
    return ["请写出自然的英文表达：", info.basicCue].filter(Boolean).join("\n\n");
  }
  return ["请写出对应的英文单词：", info.basicCue].filter(Boolean).join("\n\n");
}

export function normalizeAnkiInfo(
  data: Partial<WordExplanation>,
  sourceSentence = "",
): AnkiCardInfo {
  const rawAnki = (data.anki ?? {}) as Partial<AnkiCardInfo>;
  const word = String(data.word ?? "");
  const localCloze = buildLocalCloze(sourceSentence, word);
  const suppliedCloze = String(rawAnki.clozeSentence ?? "").trim();
  const clozeSentence = sourceSentence.trim()
    ? localCloze
    : suppliedCloze.includes("________")
      ? suppliedCloze
      : "";
  const isStandaloneCard =
    rawAnki.cardMode === "basic_en_to_cn"
    || rawAnki.cardMode === "basic_cn_to_en_dictionary";
  const hasImportedBasicNote =
    Boolean(rawAnki.ankiNoteId) && rawAnki.cardMode === "basic_cn_to_en";
  const canMakeCloze = !isStandaloneCard && !hasImportedBasicNote && Boolean(clozeSentence);
  const inferredMode: AnkiCardMode =
    rawAnki.cardMode === "cloze_context"
      || rawAnki.cardMode === "basic_cn_to_en"
      || rawAnki.cardMode === "basic_en_to_cn"
      || rawAnki.cardMode === "basic_cn_to_en_dictionary"
      ? rawAnki.cardMode
      : canMakeCloze
        ? "cloze_context"
        : "basic_cn_to_en";
  const cardMode: AnkiCardMode = canMakeCloze
    ? "cloze_context"
    : inferredMode === "cloze_context"
      ? "basic_cn_to_en"
      : inferredMode;
  const contextCue = buildChineseCue(data);
  const basicCue = String(rawAnki.basicCue || firstMeaning(String(data.basicMeaning ?? "")));
  const frontPreview = buildFrontPreview({
    cardMode,
    clozeSentence: cardMode === "cloze_context" ? clozeSentence : "",
    contextCue,
    basicCue,
    word,
  });

  return {
    canMakeCloze: cardMode === "cloze_context" ? canMakeCloze : false,
    cardMode,
    clozeSentence: cardMode === "cloze_context" ? clozeSentence : "",
    contextCue: cardMode === "cloze_context" ? contextCue : "",
    basicCue,
    frontPreview,
    backPreview:
      cardMode === "basic_en_to_cn"
        ? String(data.basicMeaning ?? "")
        : cardMode === "basic_cn_to_en_dictionary"
          ? word
          : "",
    ankiNoteId: rawAnki.ankiNoteId ?? null,
    ankiImportedAt: rawAnki.ankiImportedAt ?? null,
  };
}
