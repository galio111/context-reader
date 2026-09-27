import test from "node:test";
import assert from "node:assert/strict";
import { prepareCover } from "../lib/coverMediaQueue";

test("actual image assignments obey network/decode limits and subscriber cleanup", async () => {
  const originals = new Map(["window", "Image", "IntersectionObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let active = 0, maxNetwork = 0, decodeActive = 0, maxDecode = 0;
  const timeouts: Array<() => void> = [];
  let cancelledTransfers = 0;
  const images: FakeImage[] = [], decodes: Array<() => void> = [];
  class FakeImage {
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    sizes = ""; srcset = ""; decoding = ""; loaded = false;
    set src(_value: string) { active++; maxNetwork = Math.max(maxNetwork, active); images.push(this); }
    removeAttribute(name: string) { if (name === "src" && !this.loaded) { this.loaded = true; active--; cancelledTransfers++; } }
    load() { if (this.loaded) return; this.loaded = true; active--; this.onload?.(); }
    decode() {
      decodeActive++; maxDecode = Math.max(maxDecode, decodeActive);
      return new Promise<void>(resolve => decodes.push(() => { decodeActive--; resolve(); }));
    }
  }
  class Observer {
    constructor(private callback: (entries: Array<{target: unknown; isIntersecting: boolean}>) => void, private options: { rootMargin: string }) {}
    observe(target: HTMLElement) {
      const box = target.getBoundingClientRect();
      this.callback([{ target, isIntersecting: box.top < 900 + parseInt(this.options.rootMargin) }]);
    }
    unobserve() {} disconnect() {}
  }
  const windowMock = { innerHeight: 900, scrollY: 0, devicePixelRatio: 2, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, setTimeout: (callback: () => void, delay: number) => { timeouts.push(callback); return setTimeout(callback, delay); }, };
  for (const [key, value] of Object.entries({ window: windowMock, Image: FakeImage, IntersectionObserver: Observer })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const cleanups: Array<() => void> = []; const done: number[] = [];
  try {
    for (let i = 0; i < 10; i++) cleanups.push(prepareCover({ getBoundingClientRect: () => ({ top: 3000 + i * 50, bottom: 3100 + i * 50 }) } as HTMLElement, {
      src: `/cover-${i}.webp`, srcSet: `/cover-${i}.webp 1000w`, sizes: "500px", done: () => done.push(i),
    }));
    cleanups.push(prepareCover({ getBoundingClientRect: () => ({ top: 5000, bottom: 5100 }) } as HTMLElement, {
      src: "/distant.webp", sizes: "500px", done: () => assert.fail("distant media must remain unrequested"),
    }));
    assert.equal(images.length, 4); cleanups[0]();
    timeouts[1](); // A stalled transfer must end before another takes its slot.
    assert.equal(cancelledTransfers, 1);
    assert.equal(active, 4);
    for (let round = 0; round < 20 && done.length < 9; round++) {
      for (const image of [...images]) image.load();
      for (const finish of decodes.splice(0)) finish();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(done.length, 9); assert.ok(!done.includes(0));
    assert.equal(maxNetwork, 4); assert.equal(maxDecode, 2);
    assert.equal(images.length, 10);
    assert.ok(images.every(image => image.srcset && image.sizes === "500px"));
  } finally {
    cleanups.forEach(cleanup => cleanup());
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
