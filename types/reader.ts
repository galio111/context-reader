export type Difficulty = "easy" | "medium" | "hard";

export type TokenType = "word" | "text";

export interface ReaderToken {
  id: string;
  type: TokenType;
  value: string;
  paragraphIndex: number;
  tokenIndex: number;
  start: number;
  end: number;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
}

export interface ParsedParagraph {
  id: string;
  tokens: ReaderToken[];
}

export interface ReaderViewportAnchor {
  blockId: string;
  blockIndex: number;
  blockText: string;
  top: number;
  scrollY: number;
  scrollRatio: number;
}

export interface ReaderViewportActivity {
  rapidScroll: boolean;
  atBottom: boolean;
  settledAt: number;
}

export interface ReaderViewportReport {
  anchor: ReaderViewportAnchor;
  activity: ReaderViewportActivity;
}

export interface ReaderReadingProgress extends ReaderViewportAnchor {
  capturedAt: string;
}

export interface ArticleReadingState {
  articleId: string;
  lastOpenedAt: string;
  updatedAt: string;
  readingProgress?: ReaderReadingProgress;
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

export interface SentenceQuestionRequest extends ExplanationRequest {
  question: string;
}

export interface SentenceQuestionAnswer {
  answer: string;
}

export interface ArticleTranslationBlock {
  id: string;
  type: "heading" | "subheading" | "paragraph" | "quote" | "list-item" | "caption" | "table";
  text: string;
}

export interface ArticleTranslationItem {
  id: string;
  translation: string;
}

export interface ArticleTranslationResult {
  translations: ArticleTranslationItem[];
}
