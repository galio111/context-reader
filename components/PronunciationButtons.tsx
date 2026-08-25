"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  PronunciationRequestError,
  requestPronunciationMedia,
  requestPronunciationPair,
} from "@/lib/pronunciationClient";
import type { PronunciationAccent } from "@/lib/pronunciation";

interface PronunciationButtonsProps {
  text: string;
  preload?: boolean;
}

let sharedAudioContext: AudioContext | null = null;

function supportsBrowserSpeech(): boolean {
  return (
    typeof window !== "undefined"
    && "speechSynthesis" in window
    && typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

function pickBrowserVoice(accent: PronunciationAccent): SpeechSynthesisVoice | null {
  const target = accent.toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang.toLowerCase().replace("_", "-") === target)
    ?? voices.find((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(target))
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
    ?? null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  sharedAudioContext ??= new AudioContextConstructor();
  return sharedAudioContext;
}

function playbackErrorMessage(error: unknown, accent: PronunciationAccent): string {
  const accentLabel = accent === "en-US" ? "美音" : "英音";
  if (error instanceof PronunciationRequestError) {
    if (error.code === "pronunciation_not_configured") {
      return `云端${accentLabel}尚未配置。`;
    }
    if (error.code === "pronunciation_network") {
      return `当前网络无法连接云端${accentLabel}，请检查网络后重试。`;
    }
  }
  return `云端${accentLabel}暂时不可用，请稍后重试。`;
}

export const PronunciationButtons = memo(function PronunciationButtons({
  text,
  preload = false,
}: PronunciationButtonsProps) {
  const [playingAccent, setPlayingAccent] = useState<PronunciationAccent | null>(null);
  const [loadingAccent, setLoadingAccent] = useState<PronunciationAccent | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const playbackRequestIdRef = useRef(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");

  function releaseAudio() {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // The source may already have ended.
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    if (supportsBrowserSpeech()) {
      window.speechSynthesis.cancel();
    }
  }

  function stopPlayback() {
    playbackRequestIdRef.current += 1;
    releaseAudio();
    setLoadingAccent(null);
    setPlayingAccent(null);
  }

  useEffect(() => {
    if (!preload || !text.trim()) return;
    void requestPronunciationPair(text).catch(() => {
      // A visible click reports the actionable error; background preparation is silent.
    });
  }, [preload, text]);

  useEffect(() => {
    return () => {
      playbackRequestIdRef.current += 1;
      releaseAudio();
    };
  }, []);

  async function playWithHtmlAudio(
    bytes: Uint8Array,
    contentType: string,
    playbackRequestId: number,
  ): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    const audio = new Audio(url);
    audio.preload = "auto";
    audioRef.current = audio;
    audioUrlRef.current = url;
    audio.onended = () => {
      if (playbackRequestIdRef.current === playbackRequestId) {
        releaseAudio();
        setPlayingAccent(null);
      }
    };
    await audio.play();
  }

  async function playDecodedAudio(
    bytes: Uint8Array,
    playbackRequestId: number,
    context: AudioContext,
  ): Promise<void> {
    await context.resume();
    const encodedAudio = Uint8Array.from(bytes).buffer;
    const decodedAudio = await context.decodeAudioData(encodedAudio);
    if (playbackRequestIdRef.current !== playbackRequestId) return;

    const source = context.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(context.destination);
    source.onended = () => {
      if (
        playbackRequestIdRef.current === playbackRequestId
        && sourceRef.current === source
      ) {
        source.disconnect();
        sourceRef.current = null;
        setPlayingAccent(null);
      }
    };
    sourceRef.current = source;
    source.start();
  }

  function playWithBrowserSpeech(
    spokenText: string,
    accent: PronunciationAccent,
    playbackRequestId: number,
  ): Promise<void> {
    if (!supportsBrowserSpeech()) {
      return Promise.reject(new Error("Browser speech synthesis is unavailable."));
    }

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = accent;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.voice = pickBrowserVoice(accent);
      utterance.onend = () => {
        if (playbackRequestIdRef.current === playbackRequestId) {
          setPlayingAccent(null);
        }
        resolve();
      };
      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(event.error));
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  async function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!spokenText) return;
    if (playingAccent === accent || loadingAccent === accent) {
      stopPlayback();
      return;
    }

    stopPlayback();
    setPlaybackError("");
    setLoadingAccent(accent);
    const playbackRequestId = playbackRequestIdRef.current;
    const context = getAudioContext();
    const resumePromise = context?.resume();

    try {
      const media = await requestPronunciationMedia(spokenText, accent);
      if (playbackRequestIdRef.current !== playbackRequestId) return;
      await resumePromise;
      setLoadingAccent(null);
      setPlayingAccent(accent);
      if (context) {
        await playDecodedAudio(media.bytes, playbackRequestId, context);
      } else {
        await playWithHtmlAudio(
          media.bytes,
          media.contentType,
          playbackRequestId,
        );
      }
    } catch (error) {
      if (playbackRequestIdRef.current !== playbackRequestId) return;
      releaseAudio();
      try {
        setLoadingAccent(null);
        setPlayingAccent(accent);
        setPlaybackError("云端发音暂不可用，已切换为当前设备的本地语音。");
        await playWithBrowserSpeech(spokenText, accent, playbackRequestId);
      } catch {
        setPlayingAccent(null);
        setPlaybackError(playbackErrorMessage(error, accent));
      }
    }
  }

  const buttonClassName = "cr-pronunciation-control inline-flex h-11 items-center gap-1.5 rounded-full border border-[#d2d2d7] bg-white px-3.5 text-sm font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 lg:h-8 lg:gap-1 lg:px-2.5 lg:text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="发音选项">
      <button
        type="button"
        className={buttonClassName}
        onClick={() => void playPronunciation("en-US")}
        aria-label={`播放 ${text} 的美式发音`}
        aria-pressed={playingAccent === "en-US"}
        aria-busy={loadingAccent === "en-US"}
        title="美式发音"
      >
        <span aria-hidden="true">{loadingAccent === "en-US" ? "…" : playingAccent === "en-US" ? "■" : "▶"}</span>
        <span>{loadingAccent === "en-US" ? "准备中" : "美音"}</span>
      </button>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => void playPronunciation("en-GB")}
        aria-label={`播放 ${text} 的英式发音`}
        aria-pressed={playingAccent === "en-GB"}
        aria-busy={loadingAccent === "en-GB"}
        title="英式发音"
      >
        <span aria-hidden="true">{loadingAccent === "en-GB" ? "…" : playingAccent === "en-GB" ? "■" : "▶"}</span>
        <span>{loadingAccent === "en-GB" ? "准备中" : "英音"}</span>
      </button>
      {playbackError && (
        <p className="basis-full text-xs leading-5 text-[#6e6e73]" role="status">
          {playbackError}
        </p>
      )}
    </div>
  );
});
