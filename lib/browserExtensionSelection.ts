import { LATIN_WORD_SOURCE } from "./latinWords";
const SHORT_PHRASE = new RegExp(`^${LATIN_WORD_SOURCE}(?:\\s+${LATIN_WORD_SOURCE}){0,2}$`, "u");
export function completeExtensionSelection(text: string, start: number, end: number) {
  start = Math.max(0, Math.min(text.length, start)); end = Math.max(start, Math.min(text.length, end));
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start === end) return { text: "", start, end };
  for (const match of text.matchAll(new RegExp(LATIN_WORD_SOURCE, "gu"))) {
    const left = match.index, right = left + match[0].length;
    if (left < start && start < right) start = left;
    if (left < end && end < right) end = right;
  }
  return { text: text.slice(start, end), start, end };
}
export function extensionSelectionMode(value: unknown): "word" | "translation" | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null;
  const words = text.match(new RegExp(LATIN_WORD_SOURCE, "gu")) || [];
  if (words.length >= 4) return "translation";
  return SHORT_PHRASE.test(text) && text.length <= 160 ? "word" : null;
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
