"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  PronunciationRequestError,
  type PronunciationMedia,
  requestPronunciationMedia,
} from "@/lib/pronunciationClient";
import { PronunciationPlaybackError, pronunciationGestureSilence, withAudioTimeout } from "@/lib/pronunciationPlayback";
import type { PronunciationAccent } from "@/lib/pronunciation";

interface PronunciationButtonsProps {
  text: string;
  preload?: boolean;
  accents?: PronunciationAccent[];
  displayText?: string;
  phonetics?: Partial<Record<PronunciationAccent, string>>;
  allowBrowserFallback?: boolean;
}

let activePlayback: { owner: object; stop: () => void } | null = null;
const DEFAULT_ACCENTS: PronunciationAccent[] = ["en-US", "en-GB"];

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

function playbackErrorMessage(error: unknown, accent: PronunciationAccent): string {
  if (error instanceof PronunciationPlaybackError || (error instanceof Error && error.name === "NotAllowedError")) {
    return "声音未能启动，请再点一次发音按钮。";
  }
  const accentLabel = accent === "en-US" ? "美音" : "英音";
  if (error instanceof PronunciationRequestError) {
    if (error.code === "unsupported_pronunciation_phonetic") {
      return `这条${accentLabel}音标暂不支持朗读。`;
    }
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
  accents = DEFAULT_ACCENTS,
  displayText = text,
  phonetics,
  allowBrowserFallback = true,
}: PronunciationButtonsProps) {
  const [playingAccent, setPlayingAccent] = useState<PronunciationAccent | null>(null);
  const [loadingAccent, setLoadingAccent] = useState<PronunciationAccent | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const playbackRequestIdRef = useRef(0);
  const playbackOwnerRef = useRef<object>({});
  const browserSpeechRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const preparedMediaRef = useRef(new Map<PronunciationAccent, PronunciationMedia>());
  const playbackCleanupRef = useRef<(() => void) | null>(null);
  const accentKey = accents.join(",");
  const usPhonetic = phonetics?.["en-US"];
  const ukPhonetic = phonetics?.["en-GB"];

  function releaseAudio() {
    playbackCleanupRef.current?.();
    playbackCleanupRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.onpause = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    if (browserSpeechRef.current && supportsBrowserSpeech()) {
      browserSpeechRef.current = false;
      window.speechSynthesis.cancel();
    }
  }

  function stopPlayback() {
    playbackRequestIdRef.current += 1;
    releaseAudio();
    if (activePlayback?.owner === playbackOwnerRef.current) activePlayback = null;
    setLoadingAccent(null);
    setPlayingAccent(null);
  }

  useEffect(() => {
    if (!preload || !text.trim()) return;
    const selectedAccents = accentKey.split(",") as PronunciationAccent[];
    let disposed = false;
    void Promise.all(selectedAccents.map(async accent => {
      const media = await requestPronunciationMedia(text, accent, accent === "en-US" ? usPhonetic : ukPhonetic);
      if (disposed) return;
      preparedMediaRef.current.set(accent, media);
    })).catch(() => {
      // A visible click reports the actionable error; background preparation is silent.
    });
    return () => { disposed = true; };
  }, [preload, text, accentKey, usPhonetic, ukPhonetic]);

  useEffect(() => {
    setLoadingAccent(null);
    setPlayingAccent(null);
    setPlaybackError("");
    return () => {
      playbackRequestIdRef.current += 1;
      releaseAudio();
      preparedMediaRef.current.clear();
      if (activePlayback?.owner === playbackOwnerRef.current) activePlayback = null;
    };
  }, [text, accentKey, usPhonetic, ukPhonetic]);

  useEffect(() => {
    const hide = () => { if (document.hidden) stopPlayback(); };
    const leave = () => stopPlayback();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
    // Refs own playback; a background return must never revive a stale word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function markPlaying(accent: PronunciationAccent, requestId: number) {
    if (playbackRequestIdRef.current !== requestId) return;
    setLoadingAccent(null);
    setPlayingAccent(accent);
  }

  async function playWithHtmlAudio(
    bytes: Uint8Array,
    contentType: string,
    playbackRequestId: number,
    accent: PronunciationAccent,
    audio = new Audio(),
  ): Promise<void> {
    // A cold request reuses the exact element authorized by this click. Safari
    // grants playback per element, not to another player created after fetch.
    audio.pause();
    audio.loop = false;
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    audio.src = url;
    audio.preload = "auto";
    audioRef.current = audio;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = url;
    audio.onended = () => {
      if (playbackRequestIdRef.current === playbackRequestId) {
        releaseAudio();
        setPlayingAccent(null);
      }
    };
    const interrupted = () => {
      if (playbackRequestIdRef.current !== playbackRequestId || audioRef.current !== audio) return;
      stopPlayback();
      setPlaybackError("播放已中断，请再点一次发音按钮。");
    };
    audio.onerror = interrupted;
    // A queued pause from replacing the silent source must not cancel the word.
    audio.onpause = () => { if (audio.paused && !audio.ended) interrupted(); };
    // For a prepared recording this executes inside the click, with no await first.
    await withAudioTimeout(audio.play(), 5000);
    if (playbackRequestIdRef.current !== playbackRequestId) { audio.pause(); return; }
    markPlaying(accent, playbackRequestId);
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
      const startTimer = setTimeout(() => reject(new PronunciationPlaybackError("blocked")), 3000);
      playbackCleanupRef.current = () => clearTimeout(startTimer);
      utterance.onstart = () => {
        clearTimeout(startTimer);
        markPlaying(accent, playbackRequestId);
      };
      utterance.onend = () => {
        clearTimeout(startTimer);
        if (playbackRequestIdRef.current === playbackRequestId) {
          browserSpeechRef.current = false;
          setPlayingAccent(null);
        }
        resolve();
      };
      utterance.onerror = (event) => {
        clearTimeout(startTimer);
        if (event.error === "canceled" || event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(event.error));
      };
      window.speechSynthesis.cancel();
      browserSpeechRef.current = true;
      window.speechSynthesis.speak(utterance);
    });
  }

  async function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!spokenText) return;
    if (loadingAccent === accent) return;
    if (playingAccent === accent) {
      stopPlayback();
      return;
    }

    stopPlayback();
    // Different pronunciation rows are separate component instances. Starting
    // one must also cancel playback/preparation owned by any other instance.
    activePlayback?.stop();
    activePlayback = { owner: playbackOwnerRef.current, stop: stopPlayback };
    setPlaybackError("");
    setLoadingAccent(accent);
    const playbackRequestId = playbackRequestIdRef.current;
    let media = preparedMediaRef.current.get(accent);

    try {
      if (media) {
        await playWithHtmlAudio(media.bytes, media.contentType, playbackRequestId, accent);
        return;
      }
      // Start this unmuted (but silent) player synchronously in the gesture,
      // while the real recording loads. Never depend on Web Audio unlocking a
      // different playback mechanism or ask for a second click after download.
      const audio = new Audio();
      audioRef.current = audio;
      audioUrlRef.current = URL.createObjectURL(pronunciationGestureSilence());
      audio.src = audioUrlRef.current;
      audio.loop = true;
      const ready = withAudioTimeout(audio.play(), 5000).then(() => null, error => error as unknown);
      media ??= await requestPronunciationMedia(spokenText, accent, phonetics?.[accent]);
      if (playbackRequestIdRef.current !== playbackRequestId) return;
      preparedMediaRef.current.set(accent, media);
      const audioError = await ready;
      if (playbackRequestIdRef.current !== playbackRequestId) return;
      if (audioError) throw audioError;
      await playWithHtmlAudio(media.bytes, media.contentType, playbackRequestId, accent, audio);
    } catch (error) {
      if (playbackRequestIdRef.current !== playbackRequestId) return;
      // Invalidate any late decode/play result before offering another gesture.
      playbackRequestIdRef.current += 1;
      releaseAudio();
      setLoadingAccent(null);
      setPlayingAccent(null);
      if (media) {
        setPlaybackError(error instanceof Error && error.name === "NotSupportedError"
          ? "这条音频暂时无法播放，请稍后重试。"
          : "声音未能启动，请再点一次发音按钮。");
        return;
      }
      if (!allowBrowserFallback || phonetics?.[accent]) {
        setPlaybackError(playbackErrorMessage(error, accent));
        return;
      }
      const speechRequestId = playbackRequestIdRef.current;
      try {
        setLoadingAccent(accent);
        setPlaybackError("云端发音暂不可用，已切换为当前设备的本地语音。");
        await playWithBrowserSpeech(spokenText, accent, speechRequestId);
      } catch (speechError) {
        if (playbackRequestIdRef.current !== speechRequestId) return;
        playbackRequestIdRef.current += 1;
        releaseAudio();
        setLoadingAccent(null);
        setPlayingAccent(null);
        setPlaybackError(playbackErrorMessage(speechError instanceof PronunciationPlaybackError ? speechError : error, accent));
      }
    }
  }

  const buttonClassName = "cr-pronunciation-control inline-flex h-11 items-center gap-1.5 rounded-full border border-[#d2d2d7] bg-white px-3.5 text-sm font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 lg:h-8 lg:gap-1 lg:px-2.5 lg:text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="发音选项">
      {accents.includes("en-US") &&
      <button
        type="button"
        className={buttonClassName}
        onClick={() => void playPronunciation("en-US")}
        aria-label={`播放 ${displayText} 的美式发音`}
        aria-pressed={playingAccent === "en-US"}
        aria-busy={loadingAccent === "en-US"}
        title="美式发音"
      >
        <span aria-hidden="true">{playingAccent === "en-US" ? "■" : "▶"}</span>
        <span>美音</span>
      </button>}
      {accents.includes("en-GB") &&
      <button
        type="button"
        className={buttonClassName}
        onClick={() => void playPronunciation("en-GB")}
        aria-label={`播放 ${displayText} 的英式发音`}
        aria-pressed={playingAccent === "en-GB"}
        aria-busy={loadingAccent === "en-GB"}
        title="英式发音"
      >
        <span aria-hidden="true">{playingAccent === "en-GB" ? "■" : "▶"}</span>
        <span>英音</span>
      </button>}
      {playbackError && (
        <p className="basis-full text-xs leading-5 text-[#6e6e73]" role="status">
          {playbackError}
        </p>
      )}
    </div>
  );
});
