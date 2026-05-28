export type Difficulty = "easy" | "medium" | "hard";

export type TokenType = "word" | "text";

export interface ReaderToken {
  id: string;
  type: TokenType;
  value: string;
  paragraphIndex: number;
  tokenIndex: number;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
}

export interface ParsedParagraph {
  id: string;
  tokens: ReaderToken[];
}

export interface WordContext {
  word: string;
  paragraphIndex: number;
  tokenIndex: number;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
}

export interface WordExplanation {
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
  difficulty: Difficulty;
  shouldAddToVocabulary: boolean;
  anki: import("./anki").AnkiCardInfo;
}

export interface ExplanationRequest {
  word: string;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
}
