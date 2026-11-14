const SHORT_PHRASE = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,2}$/;
export function extensionSelectionMode(value: unknown): "word" | "translation" | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null;
  const words = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
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
