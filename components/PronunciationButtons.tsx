"use client";

import { useRef, useState } from "react";

type PronunciationAccent = "en-US" | "en-GB";

interface PronunciationButtonsProps {
  text: string;
}

const VOICE_LOAD_TIMEOUT_MS = 1000;
let cachedVoices: SpeechSynthesisVoice[] = [];
let voiceLoadPromise: Promise<SpeechSynthesisVoice[]> | null = null;
let speechWarmupPromise: Promise<void> | null = null;

function supportsBrowserSpeech(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

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
      voiceLoadPromise = null;
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
  const [playingAccent, setPlayingAccent] = useState<PronunciationAccent | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const playbackRequestIdRef = useRef(0);

  function preparePronunciation() {
    if (supportsBrowserSpeech()) {
      void warmSpeechEngine();
    }
  }

  async function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!spokenText) {
      return;
    }
    if (!supportsBrowserSpeech()) {
      setPlaybackError("当前浏览器没有提供系统发音能力，请尝试用手机系统浏览器打开本站。");
      return;
    }

    setPlaybackError("");
    setPlayingAccent(accent);
    const playbackRequestId = ++playbackRequestIdRef.current;
    await warmSpeechEngine();

    const loadedVoices = cachedVoices.length > 0 ? cachedVoices : await waitForVoices();

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = accent;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.voice = pickVoice(loadedVoices, accent) ?? null;
    utterance.onstart = () => {
      if (playbackRequestIdRef.current === playbackRequestId) {
        setPlayingAccent(accent);
      }
    };
    utterance.onend = () => {
      if (playbackRequestIdRef.current === playbackRequestId) {
        setPlayingAccent(null);
      }
    };
    utterance.onerror = (event) => {
      if (playbackRequestIdRef.current !== playbackRequestId) {
        return;
      }
      setPlayingAccent(null);
      if (event.error !== "canceled" && event.error !== "interrupted") {
        setPlaybackError("当前浏览器暂时无法播放发音，请检查系统语音设置。");
      }
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="发音选项">
      <button
        type="button"
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[#d2d2d7] bg-white px-3.5 text-sm font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 lg:h-8 lg:gap-1 lg:px-2.5 lg:text-xs"
        onPointerDown={preparePronunciation}
        onPointerEnter={preparePronunciation}
        onFocus={preparePronunciation}
        onClick={() => void playPronunciation("en-US")}
        aria-label={`播放 ${text} 的美式发音`}
        aria-pressed={playingAccent === "en-US"}
        title="美式发音"
      >
        <span aria-hidden="true">{playingAccent === "en-US" ? "■" : "▶"}</span>
        <span>美音</span>
      </button>
      <button
        type="button"
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[#d2d2d7] bg-white px-3.5 text-sm font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 lg:h-8 lg:gap-1 lg:px-2.5 lg:text-xs"
        onPointerDown={preparePronunciation}
        onPointerEnter={preparePronunciation}
        onFocus={preparePronunciation}
        onClick={() => void playPronunciation("en-GB")}
        aria-label={`播放 ${text} 的英式发音`}
        aria-pressed={playingAccent === "en-GB"}
        title="英式发音"
      >
        <span aria-hidden="true">{playingAccent === "en-GB" ? "■" : "▶"}</span>
        <span>英音</span>
      </button>
      {playbackError && <p className="basis-full text-xs leading-5 text-[#b42318]" role="status">{playbackError}</p>}
    </div>
  );
}
