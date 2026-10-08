import { normalizePronunciationText, requiresCurrentFormPhonetic } from "./pronunciation";
import type { PronunciationAccent } from "./pronunciation";

export function normalizePronunciationPhonetic(value: string, accent?: PronunciationAccent): string {
  let ipa = value.normalize("NFC").trim().replace(/^\/(.*)\/$/, "$1").replace(/^\[(.*)\]$/, "$1")
    .replace(/['’]/g, "ˈ").replace(/:/g, "ː");
  // In a standalone UK recording the dictionary's optional linking r is
  // absent. Resolve only this final notation, never arbitrary parentheses.
  if (accent) ipa = ipa.replace(/\(r\)$/, accent === "en-GB" ? "" : "r");
  // Single-word IPA only. No markup, alternatives, prose, or unbounded input.
  return ipa.length > 0 && ipa.length <= 100 && /^[a-zɑɐɒæɓβɔɕçɗðəɚɛɜɝɞɟɡɢɣɦɪɫɬɭɯɲŋɳɵøœɸɹɻɾʀʁʃʊʌʋʍʎʒʔθˈˌːˑ.\u0300-\u036f\u0361]+$/u.test(ipa) ? ipa : "";
}

// Volcengine's English phoneme alphabet is CMU/ARPABET, not IPA. Never send
// dictionary transcription characters as CMU phones: the API can return 200
// and playable audio even when that pronunciation is wrong.
const IPA_PHONES: Record<string, string> = {
  "tʃ": "CH", "dʒ": "JH", "eɪ": "EY", "aɪ": "AY", "aʊ": "AW", "ɔɪ": "OY",
  "əʊ": "OW", "oʊ": "OW", "ɜːr": "ER", "ɜr": "ER", "ɜː": "ER", "ɝː": "ER",
  "ɝ": "ER", "ɚ": "ER", "iː": "IY", "uː": "UW", "ɔː": "AO", "ɑː": "AA",
  "i": "IY", "ɪ": "IH", "e": "EH", "ɛ": "EH", "æ": "AE", "ə": "AH", "ʌ": "AH",
  "ɑ": "AA", "ɒ": "AA", "ɔ": "AO", "u": "UW", "ʊ": "UH",
  "p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "g": "G", "ɡ": "G",
  "f": "F", "v": "V", "θ": "TH", "ð": "DH", "s": "S", "z": "Z", "ʃ": "SH", "ʒ": "ZH",
  "h": "HH", "m": "M", "n": "N", "ŋ": "NG", "l": "L", "r": "R", "ɹ": "R", "j": "Y", "w": "W",
};
const IPA_TOKENS = Object.keys(IPA_PHONES).sort((a, b) => b.length - a.length);
const CMU_VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/;

export function ipaToCmu(value: string, accent?: PronunciationAccent): string {
  // Strip syllable dividers, not phonemes. Unknown symbols/diacritics are not
  // guessed or partly discarded. The API rejects explicit unconvertible IPA.
  let ipa = normalizePronunciationPhonetic(value, accent);
  // US word-final schwa+r is the rhotic vowel ER0 (e.g. CMUdict lever).
  // Do not fuse r at the start of the next syllable or change British phones.
  if (accent === "en-US") ipa = ipa.replace(/ə[rɹ]$/, "ɚ");
  ipa = ipa.replace(/\./g, "");
  if (!ipa) return "";
  const phones: string[] = [];
  const vowelIndices: number[] = [];
  let stress: "1" | "2" | null = null;
  let hasStress = false;
  for (let offset = 0; offset < ipa.length;) {
    if (ipa[offset] === "ˈ" || ipa[offset] === "ˌ") {
      if (stress !== null) return "";
      stress = ipa[offset] === "ˈ" ? "1" : "2";
      hasStress = true;
      offset++;
      continue;
    }
    const token = IPA_TOKENS.find(candidate => ipa.startsWith(candidate, offset));
    if (!token) return "";
    const phone = IPA_PHONES[token];
    if (CMU_VOWEL.test(phone)) {
      vowelIndices.push(phones.length);
      phones.push(phone + (stress ?? "0"));
      stress = null;
    } else phones.push(phone);
    offset += token.length;
  }
  if (stress !== null || !vowelIndices.length) return "";
  if (!hasStress) {
    if (vowelIndices.length !== 1) return ""; // No invented multisyllabic stress.
    const index = vowelIndices[0];
    phones[index] = phones[index].replace(/0$/, "1");
  }
  return phones.join(" ");
}

export function pronunciationSynthesisInput(text: string, phonetic = "", accent?: PronunciationAccent): { text: string; textType: "plain" | "ssml" } {
  const word = normalizePronunciationText(text);
  const cmu = ipaToCmu(phonetic, accent);
  if (!cmu || !requiresCurrentFormPhonetic(word)) return { text: word, textType: "plain" };
  const escaped = word.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ssml = `<speak><phoneme alphabet="cmu" ph="${cmu}">${escaped}</phoneme></speak>`;
  // The provider warns that SSML exceeding 150 characters increases bad cases.
  return ssml.length <= 150 ? { text: ssml, textType: "ssml" } : { text: word, textType: "plain" };
}
