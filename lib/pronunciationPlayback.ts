"use client";

export class PronunciationPlaybackError extends Error {
  constructor(public code: "blocked" | "decode" | "interrupted") {
    super(code);
    this.name = "PronunciationPlaybackError";
  }
}

export function withAudioTimeout<T>(work: Promise<T>, ms: number, code: "blocked" | "decode" = "blocked"): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PronunciationPlaybackError(code)), ms);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** A short PCM WAV containing only zero samples. Never mute the element: WebKit
 * authorizes unmuted playback per media element, including after a source change.
 * Looping keeps the cold request's channel alive until its real MP3 arrives. */
export function pronunciationGestureSilence(): Blob {
  const samples = 400; // 50 ms, 8 kHz mono PCM16
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  label(0, "RIFF"); view.setUint32(4, bytes.length - 8, true);
  label(8, "WAVE"); label(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, samples * 2, true);
  return new Blob([bytes], { type: "audio/wav" });
}
