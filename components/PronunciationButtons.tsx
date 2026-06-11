"use client";

import { useEffect, useState } from "react";

type PronunciationAccent = "en-US" | "en-GB";

interface PronunciationButtonsProps {
  text: string;
}

function pickVoice(voices: SpeechSynthesisVoice[], accent: PronunciationAccent): SpeechSynthesisVoice | undefined {
  return (
    voices.find((voice) => voice.lang === accent) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(accent.toLowerCase())) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
  );
}

export function PronunciationButtons({ text }: PronunciationButtonsProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  useEffect(() => {
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") {
      return;
    }

    setSupportsSpeech(true);

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!supportsSpeech || !spokenText) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = accent;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.voice = pickVoice(voices, accent) ?? null;

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
        onClick={() => playPronunciation("en-US")}
        aria-label={`播放 ${text} 的美式发音`}
        title="美式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>美</span>
      </button>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d2d2d7] bg-white px-2.5 text-xs font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        onClick={() => playPronunciation("en-GB")}
        aria-label={`播放 ${text} 的英式发音`}
        title="英式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>英</span>
      </button>
    </div>
  );
}
