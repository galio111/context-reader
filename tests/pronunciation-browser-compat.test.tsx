import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { unlockPronunciationAudio } from "../lib/pronunciationPlayback";
import { requestPronunciationMedia } from "../lib/pronunciationClient";

test("audio requests work without AbortSignal.timeout and classify interrupted body downloads", async () => {
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  const fetch = globalThis.fetch;
  let calls = 0;
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
  try {
    globalThis.fetch = async (_input, init) => {
      calls++;
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    };
    const [a, b] = await Promise.all([requestPronunciationMedia("old-safari", "en-US"), requestPronunciationMedia("old-safari", "en-US")]);
    assert.equal(calls, 1); assert.equal(a, b);
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { throw new DOMException("aborted", "AbortError"); } }) as unknown as Response;
    await assert.rejects(requestPronunciationMedia("body-interrupted", "en-US"), { code: "pronunciation_network" });
  } finally {
    globalThis.fetch = fetch;
    if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout);
  }
});

test("unlock starts a source and resumes synchronously; a running state needs a moving clock", async () => {
  const calls: string[] = [];
  let clock = 0;
  const context = {
    state: "suspended", sampleRate: 48000, destination: {},
    get currentTime() { return clock; },
    createBuffer() { return {}; },
    createBufferSource() { return { buffer: null, connect() {}, start() { calls.push("start"); }, stop() {}, disconnect() {} }; },
    resume() { calls.push("resume"); this.state = "running"; return Promise.resolve(); },
  };
  let resolved = false;
  const ready = unlockPronunciationAudio(context as unknown as AudioContext).then(() => { resolved = true; });
  assert.deepEqual(calls, ["start", "resume"]);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(resolved, false, "running alone does not establish that the audio engine advanced");
  clock = 0.1;
  await ready;
});

test("pronunciation handles denied/hung resume, native gesture retry, stale results and background return", async () => {
  const dom = new JSDOM("", { url: "https://context-reader.com", pretendToBeVisual: true });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const originalFetch = globalThis.fetch;
  let requests = 0, mode = "hang", contextCount = 0, realStarts = 0, inClick = false;
  let current: Context;
  const decodes: Array<() => void> = [];
  class Context extends dom.window.EventTarget {
    state = "suspended"; sampleRate = 48000; destination = {};
    constructor() { super(); current = this; contextCount++; }
    get currentTime() { return this.state === "running" ? performance.now() / 1000 : 0; }
    createBuffer() { return { warmup: true }; }
    createBufferSource() {
      return { buffer: null as { warmup?: boolean } | null, onended: null, connect() {}, disconnect() {}, stop() {},
        start() { if (!this.buffer?.warmup) realStarts++; else assert.ok(inClick, "warm source starts in click"); } };
    }
    resume() {
      assert.ok(inClick, "resume is never deferred until after network/decode");
      if (mode === "reject") return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      if (mode === "hang") return new Promise<void>(() => {});
      this.state = "running"; return Promise.resolve();
    }
    async decodeAudioData() {
      if (mode === "decode") throw new DOMException("decode", "EncodingError");
      if (mode === "delayed") await new Promise<void>(resolve => decodes.push(resolve));
      return {};
    }
  }
  Object.defineProperty(dom.window, "AudioContext", { value: Context, configurable: true });
  const native: NativeAudio[] = [];
  let nativeMode = "ok";
  class NativeAudio {
    preload = ""; ended = false; onended: (() => void) | null = null; onpause: (() => void) | null = null; onerror: (() => void) | null = null;
    paused = true;
    constructor(public src: string) { native.push(this); }
    play() {
      assert.ok(inClick, "prepared MP3 is played directly in a fresh click");
      if (nativeMode === "deny") return Promise.reject(new DOMException("denied", "NotAllowedError"));
      this.paused = false; return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ""; }
    load() {}
  }
  Object.defineProperty(globalThis, "Audio", { value: NativeAudio, configurable: true });
  globalThis.fetch = async () => { requests++; return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }); };
  const { PronunciationButtons } = await import("../components/PronunciationButtons");
  const { render, cleanup, waitFor, act, fireEvent } = await import("@testing-library/react");
  const ui = render(<PronunciationButtons text="hang" allowBrowserFallback={false} />);
  const button = () => ui.getByRole("button", { name: /美式发音/ });
  const click = () => { inClick = true; fireEvent.click(button()); inClick = false; };
  const error = () => assert.ok(ui.getByText("声音未能启动，请再点一次发音按钮。"));
  const word = (text: string) => ui.rerender(<PronunciationButtons text={text} allowBrowserFallback={false} />);
  try {
    click(); assert.equal(button().getAttribute("aria-pressed"), "false");
    await waitFor(error, { timeout: 3500 });
    assert.equal(button().getAttribute("aria-busy"), "false");
    const fetched = requests;
    click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));
    assert.equal(requests, fetched, "retry reuses the same audio without network or synthesis");
    assert.equal(native.length, 1);
    click(); assert.equal(native[0].paused, true);

    nativeMode = "deny"; click(); await waitFor(error);
    nativeMode = "ok"; click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));
    fireEvent(window, new dom.window.Event("pagehide"));
    assert.equal(button().getAttribute("aria-pressed"), "false");
    assert.equal(native.at(-1)!.paused, true);
    click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));

    mode = "reject"; word("reject"); click(); await waitFor(error);
    assert.equal(realStarts, 0);
    click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));

    mode = "decode"; word("decode"); click(); await waitFor(error);
    click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));

    current!.state = "closed"; mode = "delayed"; word("late-decode"); click();
    await waitFor(() => assert.equal(decodes.length, 1));
    assert.equal(contextCount, 2, "closed context is recreated on the next gesture");
    assert.equal(button().getAttribute("aria-pressed"), "false", "decoding is not playing");
    word("new-word"); await act(async () => decodes[0]());
    assert.equal(realStarts, 0, "old word cannot start after a delayed decode");

    mode = "ok"; click(); await waitFor(() => assert.equal(realStarts, 1));
    await act(async () => { current!.state = "interrupted"; current!.dispatchEvent(new dom.window.Event("statechange")); });
    assert.ok(ui.getByText("播放已中断，请再点一次发音按钮。"));
    assert.equal(button().getAttribute("aria-pressed"), "false");
    click(); await waitFor(() => assert.equal(button().getAttribute("aria-pressed"), "true"));
  } finally { cleanup(); globalThis.fetch = originalFetch; dom.window.close(); }
});
