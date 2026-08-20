import type { DictionaryResult } from "@/types/dictionary";
import type { VocabularyEntry } from "@/types/vocabulary";

export function createStandaloneVocabularyEntry(result: DictionaryResult): VocabularyEntry {
  const createdAt = new Date().toISOString();
  const isChineseToEnglish = result.direction === "cn_to_en";
  const vocabularyWord = isChineseToEnglish ? result.lemma : result.query;
  const groupedChineseToEnglishMeanings = Array.from(
    result.senses.reduce((groups, sense) => {
      const partOfSpeech = sense.partOfSpeech || "其他表达";
      groups.set(partOfSpeech, [...(groups.get(partOfSpeech) ?? []), sense]);
      return groups;
    }, new Map<string, typeof result.senses>()),
  ).flatMap(([partOfSpeech, senses]) => [
    `【${partOfSpeech}】`,
    ...senses.map((sense) => [sense.meaning, sense.phonetic].filter(Boolean).join(" ")),
  ]).join("\n");
  const basicMeaning = isChineseToEnglish
    ? groupedChineseToEnglishMeanings
    : result.senses.map((sense) => `${sense.partOfSpeech}：${sense.meaning}`).join("\n");
  const relatedNotes = isChineseToEnglish
    ? [
      ...result.senses
        .filter((sense) => sense.usageNote)
        .map((sense) => `用法提示：${sense.meaning}：${sense.usageNote}`),
      result.usageGuide ? `近义词辨析：${result.usageGuide}` : "",
      result.commonMistakes.length ? `易错点：${result.commonMistakes.join("；")}` : "",
    ].filter(Boolean).join("\n")
    : [
      result.verbForms
        ? `动词变形：过去式 ${result.verbForms.pastTense}；过去分词 ${result.verbForms.pastParticiple}；现在分词 ${result.verbForms.presentParticiple}`
        : "",
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
    id: `standalone-${vocabularyWord.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    word: vocabularyWord,
    lemma: result.lemma,
    phonetic: isChineseToEnglish
      ? result.phonetic || result.senses[0]?.phonetic || ""
      : result.phonetic,
    phoneticFor: result.phonetic
      ? result.phoneticFor
      : isChineseToEnglish ? result.senses[0]?.meaning || "" : "",
    partOfSpeech: Array.from(new Set(result.senses.map((sense) => sense.partOfSpeech))).join("、"),
    basicMeaning,
    contextMeaning: isChineseToEnglish ? result.query : basicMeaning,
    sentenceTranslation: "",
    usageNote: relatedNotes,
    collocation: (isChineseToEnglish ? [] : result.collocations)
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
      cardMode: isChineseToEnglish ? "basic_cn_to_en_dictionary" : "basic_en_to_cn",
      clozeSentence: "",
      contextCue: "",
      basicCue: isChineseToEnglish ? result.query : "",
      frontPreview: result.query,
      backPreview: isChineseToEnglish ? vocabularyWord : basicMeaning,
      ankiNoteId: null,
      ankiImportedAt: null,
    },
  };
}
