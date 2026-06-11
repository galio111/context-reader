import type { ParsedParagraph, ReaderToken, WordContext } from "@/types/reader";

const WORD_PATTERN_SOURCE = String.raw`[A-Za-z]+(?:['-][A-Za-z]+)*`;
const SENTENCE_PATTERN_SOURCE = String.raw`[^.!?]+[.!?]+["')\]]*|[^.!?]+$`;

function wordPattern(): RegExp {
  return new RegExp(WORD_PATTERN_SOURCE, "g");
}

function sentencePattern(): RegExp {
  return new RegExp(SENTENCE_PATTERN_SOURCE, "g");
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

function getSentenceSpans(paragraph: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  for (const match of paragraph.matchAll(sentencePattern())) {
    const rawText = match[0] ?? "";
    const start = match.index ?? 0;
    const text = rawText.trim();
    if (!text) {
      continue;
    }
    spans.push({
      text,
      start,
      end: start + rawText.length,
    });
  }
  return spans.length > 0
    ? spans
    : [{ text: paragraph.trim(), start: 0, end: paragraph.length }];
}

function findSentenceIndex(spans: SentenceSpan[], index: number): number {
  const foundIndex = spans.findIndex((span) => index >= span.start && index < span.end);
  return foundIndex === -1 ? 0 : foundIndex;
}

function createTextToken(
  value: string,
  paragraphIndex: number,
  tokenIndex: number,
  start: number,
  end: number,
): ReaderToken {
  return {
    id: `${paragraphIndex}-${tokenIndex}-text`,
    type: "text",
    value,
    paragraphIndex,
    tokenIndex,
    start,
    end,
    sentence: "",
    previousSentence: "",
    nextSentence: "",
  };
}

export function tokenizeArticle(article: string): ParsedParagraph[] {
  return article.split(/\r?\n/).map((paragraph, paragraphIndex) => {
    const sentenceSpans = getSentenceSpans(paragraph);
    const tokens: ReaderToken[] = [];
    let lastIndex = 0;
    let tokenIndex = 0;

    for (const match of paragraph.matchAll(wordPattern())) {
      const word = match[0] ?? "";
      const wordStart = match.index ?? 0;

      if (wordStart > lastIndex) {
        tokens.push(createTextToken(paragraph.slice(lastIndex, wordStart), paragraphIndex, tokenIndex, lastIndex, wordStart));
        tokenIndex += 1;
      }

      const sentenceIndex = findSentenceIndex(sentenceSpans, wordStart);
      const sentence = sentenceSpans[sentenceIndex];
      tokens.push({
        id: `${paragraphIndex}-${tokenIndex}-word`,
        type: "word",
        value: word,
        paragraphIndex,
        tokenIndex,
        start: wordStart,
        end: wordStart + word.length,
        sentence: sentence?.text ?? paragraph.trim(),
        previousSentence: sentenceSpans[sentenceIndex - 1]?.text ?? "",
        nextSentence: sentenceSpans[sentenceIndex + 1]?.text ?? "",
      });
      tokenIndex += 1;
      lastIndex = wordStart + word.length;
    }

    if (lastIndex < paragraph.length) {
      tokens.push(createTextToken(paragraph.slice(lastIndex), paragraphIndex, tokenIndex, lastIndex, paragraph.length));
    }

    return {
      id: `paragraph-${paragraphIndex}`,
      tokens,
    };
  });
}

export function hasClickableWords(article: string): boolean {
  return new RegExp(WORD_PATTERN_SOURCE).test(article);
}

export function tokenToWordContext(token: ReaderToken): WordContext {
  return {
    word: token.value,
    paragraphIndex: token.paragraphIndex,
    tokenIndex: token.tokenIndex,
    sentence: token.sentence,
    previousSentence: token.previousSentence,
    nextSentence: token.nextSentence,
  };
}
