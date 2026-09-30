import { normalizePronunciationText, requiresCurrentFormPhonetic } from "./pronunciation";

export function normalizePronunciationPhonetic(value: string): string {
  const ipa = value.normalize("NFC").trim().replace(/^\/(.*)\/$/, "$1").replace(/^\[(.*)\]$/, "$1")
    .replace(/['’]/g, "ˈ").replace(/:/g, "ː");
  // Single-word IPA only. No markup, alternatives, prose, or unbounded input.
  return ipa.length > 0 && ipa.length <= 100 && /^[a-zɑɐɒæɓβɔɕçɗðəɚɛɜɝɞɟɡɢɣɦɪɫɬɭɯɲŋɳɵøœɸɹɻɾʀʁʃʊʌʋʍʎʒʔθˈˌːˑ.\u0300-\u036f\u0361]+$/u.test(ipa) ? ipa : "";
}

export function pronunciationSynthesisInput(text: string, phonetic = ""): { text: string; textType: "plain" | "ssml" } {
  const word = normalizePronunciationText(text);
  const ipa = normalizePronunciationPhonetic(phonetic);
  if (!ipa || !requiresCurrentFormPhonetic(word)) return { text: word, textType: "plain" };
  const escaped = word.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return { text: `<speak><phoneme alphabet="ipa" ph="${ipa}">${escaped}</phoneme></speak>`, textType: "ssml" };
}
