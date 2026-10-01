import { normalizePronunciationText, requiresCurrentFormPhonetic } from "./pronunciation";

export function normalizePronunciationPhonetic(value: string): string {
  const ipa = value.normalize("NFC").trim().replace(/^\/(.*)\/$/, "$1").replace(/^\[(.*)\]$/, "$1")
    .replace(/['’]/g, "ˈ").replace(/:/g, "ː");
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

export function ipaToCmu(value: string): string {
  // Strip syllable dividers, not phonemes. Unknown symbols/diacritics are not
  // guessed or partly discarded: use the provider's normal word reading.
  const ipa = normalizePronunciationPhonetic(value).replace(/\./g, "");
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

export function pronunciationSynthesisInput(text: string, phonetic = ""): { text: string; textType: "plain" | "ssml" } {
  const word = normalizePronunciationText(text);
  const cmu = ipaToCmu(phonetic);
  if (!cmu || !requiresCurrentFormPhonetic(word)) return { text: word, textType: "plain" };
  const escaped = word.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ssml = `<speak><phoneme alphabet="cmu" ph="${cmu}">${escaped}</phoneme></speak>`;
  // The provider warns that SSML exceeding 150 characters increases bad cases.
  return ssml.length <= 150 ? { text: ssml, textType: "ssml" } : { text: word, textType: "plain" };
}
