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
  if (!escaped) {
    return "";
  }
  return sentence.replace(new RegExp(`\\b${escaped}\\b`, "i"), "________");
}

function buildFrontPreview(info: {
  cardMode: AnkiCardMode;
  clozeSentence: string;
  contextCue: string;
  basicCue: string;
}): string {
  if (info.cardMode === "cloze_context") {
    return [info.clozeSentence, info.contextCue].filter(Boolean).join("\n\n\n\n");
  }
  return ["请写出对应的英文单词：", info.basicCue].filter(Boolean).join("\n\n");
}

export function normalizeAnkiInfo(
  data: Partial<WordExplanation>,
  sourceSentence = "",
): AnkiCardInfo {
  const rawAnki = (data.anki ?? {}) as Partial<AnkiCardInfo>;
  const canMakeCloze = Boolean(rawAnki.canMakeCloze);
  const inferredMode: AnkiCardMode =
    rawAnki.cardMode === "cloze_context" || rawAnki.cardMode === "basic_cn_to_en"
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
  const clozeSentence =
    cardMode === "cloze_context"
      ? String(rawAnki.clozeSentence || buildLocalCloze(sourceSentence, String(data.word ?? "")))
      : "";
  const frontPreview = buildFrontPreview({
    cardMode,
    clozeSentence,
    contextCue,
    basicCue,
  });

  return {
    canMakeCloze: cardMode === "cloze_context" ? canMakeCloze : false,
    cardMode,
    clozeSentence,
    contextCue: cardMode === "cloze_context" ? contextCue : "",
    basicCue,
    frontPreview,
    backPreview: "",
    ankiNoteId: rawAnki.ankiNoteId ?? null,
    ankiImportedAt: rawAnki.ankiImportedAt ?? null,
  };
}
