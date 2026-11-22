import { hasLatinLetter, isLookupPhrase, lookupTerms } from "./latinWords";

type ExtensionTarget = { mode: "word" | "translation"; text: string; start: number; end: number };
const EDGE_PUNCTUATION = /^[\s.,!?;:()[\]{}"'“”‘’«»…—–，。！？、：；（）【】]*$/u;

export function completeExtensionSelection(text: string, start: number, end: number) {
  start = Math.max(0, Math.min(text.length, start)); end = Math.max(start, Math.min(text.length, end));
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start === end) return { text: "", start, end };
  for (const match of lookupTerms(text)) {
    const left = match.index, right = left + match[0].length;
    if (left >= end) break;
    if (left < start && start < right) start = left;
    if (left < end && end < right) end = right;
  }
  return { text: text.slice(start, end), start, end };
}

/** Offsets refer to the supplied selection. Sentence translations keep their original punctuation. */
export function extensionSelectionTarget(value: unknown): ExtensionTarget | null {
  if (typeof value !== "string" || value.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return null;
  const text = value.trim();
  if (!text) return null;
  const offset = value.length - value.trimStart().length;
  const terms = Array.from(lookupTerms(text));
  if (terms.filter(term => hasLatinLetter(term[0])).length >= 4) {
    return { mode: "translation", text, start: offset, end: offset + text.length };
  }
  const first = terms[0], last = terms.at(-1);
  if (!first || !last || text.length > 160) return null;
  const start = first.index, end = last.index + last[0].length;
  const phrase = text.slice(start, end);
  if (!EDGE_PUNCTUATION.test(text.slice(0, start)) || !EDGE_PUNCTUATION.test(text.slice(end)) || !isLookupPhrase(phrase)) return null;
  return { mode: "word", text: phrase.replace(/[’ʼ]/g, "'").replace(/\s+/g, " "), start: offset + start, end: offset + end };
}

export function extensionSelectionMode(value: unknown) {
  return extensionSelectionTarget(value)?.mode ?? null;
}

/** Only the selection is a target. Nearby sentences are read-only context. */
export function extensionTranslationInput(value: unknown) {
  const input = value as { text?: unknown; sentence?: unknown; previousSentence?: unknown; nextSentence?: unknown } | null;
  if (!input || extensionSelectionMode(input.text) !== "translation") return null;
  const text = (input.text as string).trim();
  const context = [input.previousSentence, input.sentence, input.nextSentence]
    .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
    .map(v => v.trim().slice(0, 5000));
  return {
    blocks: [{ id: "extension-selection", type: "paragraph" as const, text }],
    contextBlocks: context.length ? context.map((text, i) => ({ id: `extension-context-${i}`, type: "paragraph" as const, text }))
      : [{ id: "extension-selection", type: "paragraph" as const, text }],
  };
}
