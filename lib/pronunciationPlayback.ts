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

/** Call synchronously from the click, before fetching or decoding audio. */
export function unlockPronunciationAudio(context: AudioContext): Promise<void> {
  let warmup: AudioBufferSourceNode | undefined;
  try {
    if (context.state !== "running") {
      warmup = context.createBufferSource();
      warmup.buffer = context.createBuffer(1, 1, context.sampleRate);
      warmup.connect(context.destination);
      // WebKit needs an actual source start in the trusted gesture as well as resume.
      warmup.start(0);
    }
    const resumed = context.resume();
    const initialTime = context.currentTime;
    // Some interrupted contexts report running while their audio clock is frozen.
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeout);
        if (warmup) { try { warmup.stop(); } catch { /* already ended */ } warmup.disconnect(); }
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (context.state === "closed") finish(new PronunciationPlaybackError("interrupted"));
        else if (context.state === "running" && context.currentTime > initialTime) finish();
      };
      const poll = setInterval(check, 40);
      const timeout = setTimeout(() => finish(new PronunciationPlaybackError("blocked")), 2000);
      resumed.then(check, finish);
    });
  } catch (error) {
    if (warmup) { try { warmup.stop(); } catch { /* not started */ } warmup.disconnect(); }
    return Promise.reject(error);
  }
}
