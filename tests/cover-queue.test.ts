import test from "node:test";
import assert from "node:assert/strict";
import { prepareCover, warmCovers, preparedCover } from "../lib/coverMediaQueue";

test("warmup, viewport promotion, failures and cancellation obey shared network/decode limits", async () => {
  const originals = new Map(["window", "document", "Image", "IntersectionObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let active = 0, maxNetwork = 0, decodeActive = 0, maxDecode = 0, cancelledTransfers = 0;
  let hidden = false, criticalPending = true;
  const listeners = new Map<string, () => void>();
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const images: FakeImage[] = [], decodes: Array<() => void> = [];
  const done: string[] = [], cleanups: Array<() => void> = [];
  class FakeImage {
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    sizes = ""; srcset = ""; decoding = ""; fetchPriority = ""; loaded = false; url = "";
    set src(value: string) { this.url = value; active++; maxNetwork = Math.max(maxNetwork, active); images.push(this); }
    removeAttribute(name: string) { if (name === "src" && !this.loaded) { this.loaded = true; active--; cancelledTransfers++; } }
    load() { if (this.loaded) return; this.loaded = true; active--; this.onload?.(); }
    fail() { if (this.loaded) return; this.loaded = true; active--; this.onerror?.(); }
    decode() {
      decodeActive++; maxDecode = Math.max(maxDecode, decodeActive);
      return new Promise<void>(resolve => decodes.push(() => { decodeActive--; resolve(); }));
    }
  }
  class Observer {
    constructor(private callback: (entries: Array<{target: unknown; isIntersecting: boolean; boundingClientRect: {top:number;bottom:number}}>) => void) {}
    observe(target: HTMLElement) { const box = target.getBoundingClientRect(); this.callback([{target, isIntersecting:box.top < 3600, boundingClientRect:box}]); }
    unobserve() {} disconnect() {}
  }
  const windowMock = {
    innerHeight: 900, innerWidth: 1400, scrollY: 0, devicePixelRatio: 2, matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {},
    setTimeout: (callback: () => void, delay: number) => { const id = setTimeout(callback, delay); if (delay === 20000) timers.set(id, callback); return id; },
  };
  const documentMock = {
    get hidden() { return hidden; },
    querySelectorAll: () => criticalPending ? [{complete:false}] : [],
    addEventListener: (name:string, callback:()=>void) => listeners.set(name, callback),
    removeEventListener: (name:string) => listeners.delete(name),
  };
  for (const [key, value] of Object.entries({ window: windowMock, document: documentMock, Image: FakeImage, IntersectionObserver: Observer })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const turn = () => new Promise(resolve => setTimeout(resolve, 4));
  const source = (i:number) => ({src:`/warm-${i}.webp`,srcSet:`/warm-${i}.webp 1000w`,sizes:"500px"});
  const element = (top:number) => ({getBoundingClientRect:()=>({top,bottom:top+100})}) as HTMLElement;
  try {
    cleanups.push(warmCovers(Array.from({length:100},(_,i)=>source(i))));
    await turn(); assert.equal(images.length,0,"showcase images finish before library warmup competes");
    criticalPending = false; listeners.get("load")?.(); await turn();
    assert.equal(active,2,"background leaves two foreground network slots free");
    cleanups.push(prepareCover(element(200),{...source(0),done:()=>done.push("shared")}));
    cleanups.push(prepareCover(element(300),{...source(50),done:()=>done.push("visible")}));
    const cancel = prepareCover(element(400),{...source(51),done:()=>assert.fail("cancelled subscriber")});
    await turn(); assert.equal(active,4); assert.equal(images.filter(i=>i.url===source(0).src).length,1,"warmup and cards share the same transfer");
    assert.ok(images.find(i=>i.url===source(50).src));
    cancel();
    const timeout = [...timers.values()].at(-1)!; timeout();
    assert.equal(cancelledTransfers,1);
    images.find(i=>i.url===source(50).src)!.fail();
    await turn(); assert.ok(done.includes("visible"),"real errors resolve the visible subscriber");
    for (let round=0;round<160 && images.length<100;round++) {
      for (const image of [...images]) image.load();
      for (const finish of decodes.splice(0)) finish();
      await turn();
    }
    for (let round=0;round<6;round++) { images.forEach(i=>i.load());decodes.splice(0).forEach(f=>f());await turn(); }
    assert.ok(done.includes("shared"));
    assert.equal(images.length,100,"collapsed distant covers are downloaded too");
    assert.equal(maxNetwork,4); assert.ok(maxDecode<=2);
    assert.ok(preparedCover(source(99)),"download readiness survives decoded-window eviction");
    const before = images.length;
    const cancelReady = prepareCover(element(200),{...source(99),done:()=>done.push("cached")}); cancelReady();
    assert.ok(done.includes("cached")); assert.equal(images.length,before,"mounting a warmed card makes no second transfer");
    hidden = true;
    cleanups.push(warmCovers([{src:"/hidden.webp",sizes:"500px"}])); await turn();
    assert.equal(images.length,before,"hidden tabs do not continue bulk network work");
    hidden=false; listeners.get("visibilitychange")?.(); await turn();
    assert.equal(images.length,before+1);
    images.at(-1)!.load(); decodes.splice(0).forEach(f=>f()); await turn();
  } finally {
    cleanups.forEach(cleanup=>cleanup()); timers.forEach((_,id)=>clearTimeout(id));
    await turn();
    for (const [key,descriptor] of originals) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
