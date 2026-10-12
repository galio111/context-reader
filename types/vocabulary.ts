import type { Difficulty } from "./reader";
import type { AnkiCardInfo } from "./anki";
import type { DictionaryResult } from "./dictionary";

export interface VocabularySourceArticle {
  kind: "public";
  id: string;
  title: string;
}

export interface VocabularyEntry {
  dictionaryResult?: DictionaryResult;
  dictionaryUpdatedAt?: string;
  explanationUpdatedAt?: string;
  id: string;
  word: string;
  lemma: string;
  phonetic: string;
  phoneticFor?: string;
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
  sourceArticle?: VocabularySourceArticle;
  difficulty: Difficulty;
  shouldAddToVocabulary: boolean;
  createdAt: string;
  updatedAt: string;
  anki: AnkiCardInfo;
}
