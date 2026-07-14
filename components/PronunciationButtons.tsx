"use client";

type PronunciationAccent = "en-US" | "en-GB";

interface PronunciationButtonsProps {
  text: string;
}

const VOICE_LOAD_TIMEOUT_MS = 1000;
let cachedVoices: SpeechSynthesisVoice[] = [];
let voiceLoadPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let speechWarmupPromise: Promise<void> | null = null;

function voiceNameScore(voice: SpeechSynthesisVoice, accent: PronunciationAccent): number {
  const lang = voice.lang.toLowerCase().replace("_", "-");
  const name = voice.name.toLowerCase();
  if (accent === "en-GB") {
    if (lang === "en-gb") {
      return 100;
    }
    if (name.includes("british") || name.includes("uk english") || name.includes("united kingdom")) {
      return 90;
    }
    if (["daniel", "serena", "kate", "oliver", "libby", "ryan", "george", "hazel", "sonia"].some((item) => name.includes(item))) {
      return 80;
    }
  }
  if (accent === "en-US") {
    if (lang === "en-us") {
      return 100;
    }
    if (name.includes("us english") || name.includes("united states")) {
      return 90;
    }
    if (["zira", "david", "jenny", "aria", "samantha", "alex"].some((item) => name.includes(item))) {
      return 80;
    }
  }
  if (lang.startsWith(accent.toLowerCase())) {
    return 70;
  }
  if (lang.startsWith("en")) {
    return 10;
  }
  return 0;
}

function pickVoice(voices: SpeechSynthesisVoice[], accent: PronunciationAccent): SpeechSynthesisVoice | undefined {
  return [...voices]
    .map((voice) => ({ voice, score: voiceNameScore(voice, accent) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.voice;
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    cachedVoices = existing;
    return Promise.resolve(cachedVoices);
  }

  if (voiceLoadPromise) {
    return voiceLoadPromise;
  }

  voiceLoadPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, VOICE_LOAD_TIMEOUT_MS);
  });

  return voiceLoadPromise;
}

function warmSpeechEngine(): Promise<void> {
  if (speechWarmupPromise) {
    return speechWarmupPromise;
  }

  speechWarmupPromise = (async () => {
    const loadedVoices = await waitForVoices();

    await new Promise<void>((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(".");
        const timeoutId = window.setTimeout(resolve, 1000);
        const finish = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        utterance.lang = "en-US";
        utterance.volume = 0;
        utterance.rate = 1;
        utterance.voice = pickVoice(loadedVoices, "en-US") ?? null;
        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  })();

  return speechWarmupPromise;
}

export function PronunciationButtons({ text }: PronunciationButtonsProps) {
  const supportsSpeech =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined";

  async function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!supportsSpeech || !spokenText) {
      return;
    }

    await warmSpeechEngine();

    const loadedVoices = cachedVoices.length > 0 ? cachedVoices : await waitForVoices();

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = accent;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.voice = pickVoice(loadedVoices, accent) ?? null;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  if (!supportsSpeech) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5" aria-label="单词发音">
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d2d2d7] bg-white px-2.5 text-xs font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        onPointerEnter={() => void warmSpeechEngine()}
        onFocus={() => void warmSpeechEngine()}
        onClick={() => void playPronunciation("en-US")}
        aria-label={`播放 ${text} 的美式发音`}
        title="美式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>美</span>
      </button>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d2d2d7] bg-white px-2.5 text-xs font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        onPointerEnter={() => void warmSpeechEngine()}
        onFocus={() => void warmSpeechEngine()}
        onClick={() => void playPronunciation("en-GB")}
        aria-label={`播放 ${text} 的英式发音`}
        title="英式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>英</span>
      </button>
    </div>
  );
}
