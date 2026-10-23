/** PDF font mappings can contain NUL/unpaired surrogates, which JSONB rejects.
 * Keep normal Unicode (including math, Greek, CJK and surrogate pairs) intact.
 * This cleans extracted text only; original file bytes are never modified. */
export function cleanDocumentText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    value => value.length === 2 ? value : "\uFFFD");
}
