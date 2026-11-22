/** Latin letters include accents; combining marks remain attached to their letter. */
const LATIN_LETTERS = String.raw`(?:\p{Script=Latin}\p{M}*)+`;
export const LATIN_WORD_SOURCE = `${LATIN_LETTERS}(?:['’ʼ-]${LATIN_LETTERS})*`;
export const LATIN_PHRASE_PATTERN = new RegExp(`^${LATIN_WORD_SOURCE}(?:\\s+${LATIN_WORD_SOURCE}){0,7}$`, "u");

/** Lookup also recognizes terms such as P/E, R&D, U.S., COVID‑19 and C++.
 * Keep article token boundaries independent from lookup and dictionary inputs. */
const INITIALISM = String.raw`[A-Za-z](?:\.[A-Za-z])+(?![\p{L}\p{M}])\.?`;
const LOOKUP_PART = `(?:${INITIALISM}|${LATIN_LETTERS}|[0-9]+)`;
const LOOKUP_TERM = new RegExp(`${LOOKUP_PART}(?:['’ʼ/&／＆‐‑-]${LOOKUP_PART})*(?:\\+\\+|#)?`, "gu");
const TERM_SEPARATOR = /^[\s,，;；:：!?！？…–—、()（）“”‘"«»]+$/u;
export const hasLatinLetter = (value: string) => /\p{Script=Latin}/u.test(value);

export function lookupTerms(text: string) {
  return text.matchAll(LOOKUP_TERM);
}

export function isLookupPhrase(text: string): boolean {
  let end = 0, count = 0;
  for (const term of lookupTerms(text)) {
    if (++count > 8 || (count === 1 ? term.index !== 0 : !TERM_SEPARATOR.test(text.slice(end, term.index)))) return false;
    end = term.index + term[0].length;
  }
  return end === text.length && hasLatinLetter(text);
}
