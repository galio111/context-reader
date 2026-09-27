"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./FeatureShowcase.module.css";

export function ShowcaseRecording({ src, label, warm, playing, onBuffered }: { src: string; label: string; warm: boolean; playing: boolean; onBuffered: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const generation = useRef(0);
  const previousPlaybackTime = useRef(0);
  const playedOnce = useRef(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const poster = src ? src.replace(/\.mp4$/, ".webp") : undefined;
  function reportBuffered() {
    const element = video.current;
    if (playedOnce.current && element && Number.isFinite(element.duration) && element.buffered.length
      && element.buffered.end(element.buffered.length - 1) >= element.duration - 0.1) onBuffered();
  }
  function reportPlayback() {
    const element = video.current;
    if (!element) return;
    if (previousPlaybackTime.current > element.duration / 2 && element.currentTime < previousPlaybackTime.current) playedOnce.current = true;
    previousPlaybackTime.current = element.currentTime;
    reportBuffered();
  }
  useEffect(() => {
    if (!warm || !src || loadedSrc) return;
    // The retained high-resolution H.264 is smaller than the re-encoded pilot
    // and supplies enough real pixels for both layouts, with one request only.
    setLoadedSrc(src);
  }, [warm, src, loadedSrc]);
  useEffect(() => {
    const element = video.current;
    if (!element || !src || !loadedSrc) return;
    const owner = ++generation.current;
    let attempts = 0, pending = false;
    element.defaultMuted = true; element.muted = true;
    const current = () => generation.current === owner && video.current === element;
    function play() {
      if (!current() || !playing || pending || attempts >= 2) return;
      attempts++; pending = true;
      void element!.play().then(() => {
        // An old play promise must never pause a newer successful generation.
        if (current()) setBlocked(false);
      }).catch((error: unknown) => {
        if (!current()) return;
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        if (name === "NotAllowedError") setBlocked(true);
        else if (name !== "AbortError") setFailed(true);
      }).finally(() => { pending = false; });
    }
    const ready = () => { if (element!.readyState >= 2) play(); };
    element.addEventListener("canplay", ready);
    if (playing) play(); else element.pause();
    return () => {
      generation.current++; element.removeEventListener("canplay", ready); element.pause();
    };
  }, [playing, src, loadedSrc]);
  function manualPlay() {
    const owner = generation.current;
    void video.current?.play().then(() => { if (generation.current === owner) setBlocked(false); }).catch(() => {});
  }
  return <div className={styles.recording} data-has-video={Boolean(src)}>
    {src && !failed ? <>
      <video ref={video} src={loadedSrc} poster={warm ? poster : undefined} muted autoPlay={playing} loop playsInline
        preload={warm ? "auto" : "none"} onTimeUpdate={reportPlayback} onProgress={reportBuffered}
        onLoadedData={reportBuffered} onCanPlayThrough={reportBuffered}
        onError={() => { if (loadedSrc) setFailed(true); }} aria-label={label} />
      {blocked && playing && <button className={styles.play} onClick={manualPlay}>播放演示</button>}
    </> : <div className={styles.placeholder}><span className={styles.placeholderIcon} aria-hidden="true">▷</span><strong>{label}</strong><span>{failed ? "演示暂时无法播放" : "录屏预留画面"}</span></div>}
  </div>;
}
