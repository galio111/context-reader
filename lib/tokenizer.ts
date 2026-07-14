import type { ParsedParagraph, ReaderToken, WordContext } from "@/types/reader";

const WORD_PATTERN_SOURCE = String.raw`[A-Za-z]+(?:['-][A-Za-z]+)*`;
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "dr", "hon", "jr", "mr", "mrs", "ms", "no", "prof", "rev", "sen", "sr", "st",
]);
const CONTEXTUAL_ABBREVIATIONS = new Set([
  "approx", "corp", "dept", "e.g", "etc", "fig", "i.e", "inc", "jan", "feb", "mar",
  "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "vs",
]);

function wordPattern(): RegExp {
  return new RegExp(WORD_PATTERN_SOURCE, "g");
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

function previousWord(text: string, periodIndex: number): string {
  let start = periodIndex - 1;
  while (start >= 0 && /[A-Za-z.]/.test(text[start])) start -= 1;
  return text.slice(start + 1, periodIndex).toLowerCase();
}

function nextNonSpaceIndex(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function isPeriodBoundary(text: string, index: number): boolean {
  const before = text[index - 1] ?? "";
  const after = text[index + 1] ?? "";

  // Covers decimals/versions, No.1, domains, email addresses, and other
  // dot-joined tokens.
  if (/\w/.test(before) && /\w/.test(after)) return false;

  const word = previousWord(text, index);
  if (!word) return true;
  if (NON_TERMINAL_ABBREVIATIONS.has(word)) return false;

  const nextIndex = nextNonSpaceIndex(text, index + 1);
  const nextCharacter = text[nextIndex] ?? "";

  // Initials before names: "J. K. Rowling" and "A. Smith".
  if (word.length === 1 && /[A-Z]/.test(nextCharacter)) return false;

  if (CONTEXTUAL_ABBREVIATIONS.has(word) && nextCharacter && !/[A-Z]/.test(nextCharacter)) {
    return false;
  }

  // Multi-period acronyms such as U.S. and Ph.D. stay together when the text
  // after them is a lowercase continuation, but may still finish a sentence.
  if (word.includes(".") && nextCharacter && !/[A-Z]/.test(nextCharacter)) return false;

  return true;
}

function sentenceBoundaryEnd(paragraph: string, punctuationIndex: number): number {
  let end = punctuationIndex + 1;
  while (end < paragraph.length && /[.!?]/.test(paragraph[end])) end += 1;
  while (end < paragraph.length && /["'’”)}\]]/.test(paragraph[end])) end += 1;
  return end;
}

function getSentenceSpans(paragraph: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let start = 0;

  for (let index = 0; index < paragraph.length; index += 1) {
    const character = paragraph[index];
    if (character !== "!" && character !== "?" && (character !== "." || !isPeriodBoundary(paragraph, index))) {
      continue;
    }

    const end = sentenceBoundaryEnd(paragraph, index);
    const rawText = paragraph.slice(start, end);
    const text = rawText.trim();
    if (text) {
      spans.push({ text, start, end });
    }
    start = end;
    index = end - 1;
  }

  const rawText = paragraph.slice(start);
  const text = rawText.trim();
  if (text) {
    spans.push({ text, start, end: paragraph.length });
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
