import type { Difficulty } from "./reader";
import type { AnkiCardInfo } from "./anki";

export interface VocabularyEntry {
  id: string;
  word: string;
  lemma: string;
  partOfSpeech: string;
  basicMeaning: string;
  contextMeaning: string;
  sentenceTranslation: string;
  usageNote: string;
  collocation: string;
  exampleEnglish: string;
  exampleChinese: string;
  sourceSentence: string;
  previousSentence: string;
  nextSentence: string;
  difficulty: Difficulty;
  shouldAddToVocabulary: boolean;
  createdAt: string;
  anki: AnkiCardInfo;
}
