/** Latin letters include accents; combining marks remain attached to their letter. */
export const LATIN_WORD_SOURCE = String.raw`(?:\p{Script=Latin}\p{M}*)+(?:['’ʼ-](?:\p{Script=Latin}\p{M}*)+)*`;
export const LATIN_PHRASE_PATTERN = new RegExp(`^${LATIN_WORD_SOURCE}(?:\\s+${LATIN_WORD_SOURCE}){0,7}$`, "u");
