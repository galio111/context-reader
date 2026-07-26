import type { DictionaryResult } from "@/types/dictionary";
import type { VocabularyEntry } from "@/types/vocabulary";

export function createStandaloneVocabularyEntry(result: DictionaryResult): VocabularyEntry {
  const createdAt = new Date().toISOString();
  const basicMeaning = result.senses.map((sense) => `${sense.partOfSpeech}：${sense.meaning}`).join("\n");
  const relatedNotes = [
    result.usageGuide,
    result.synonyms.length
      ? `近义词辨析：${result.synonyms.map((item) => `${item.word}（${item.difference}）`).join("；")}`
      : "",
    result.wordFamily.length
      ? `词族：${result.wordFamily.map((item) => `${item.word}（${item.partOfSpeech}，${item.meaning}）`).join("；")}`
      : "",
    result.commonMistakes.length ? `易错点：${result.commonMistakes.join("；")}` : "",
    result.memoryTip ? `记忆提示：${result.memoryTip}` : "",
  ].filter(Boolean).join("\n");
  const firstExample = result.senses.find((sense) => sense.exampleEnglish || sense.exampleChinese);

  return {
    id: `standalone-${result.query.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    word: result.query,
    lemma: result.lemma,
    phonetic: result.phonetic,
    partOfSpeech: Array.from(new Set(result.senses.map((sense) => sense.partOfSpeech))).join("、"),
    basicMeaning,
    contextMeaning: basicMeaning,
    sentenceTranslation: "",
    usageNote: relatedNotes,
    collocation: result.collocations
      .map((item) => `${item.phrase}${item.meaning ? `（${item.meaning}）` : ""}${item.exampleEnglish ? `：${item.exampleEnglish}` : ""}`)
      .join("\n"),
    exampleEnglish: firstExample?.exampleEnglish ?? "",
    exampleChinese: firstExample?.exampleChinese ?? "",
    sourceSentence: "",
    previousSentence: "",
    nextSentence: "",
    difficulty: "medium",
    shouldAddToVocabulary: true,
    createdAt,
    updatedAt: createdAt,
    anki: {
      canMakeCloze: false,
      cardMode: "basic_en_to_cn",
      clozeSentence: "",
      contextCue: "",
      basicCue: "",
      frontPreview: result.query,
      backPreview: basicMeaning,
      ankiNoteId: null,
      ankiImportedAt: null,
    },
  };
}
