import type { CoverSource } from "./coverSources";

type Result = CoverSource & { error?: boolean };
type Subscriber = { element: HTMLElement; done: (result: Result) => void; nearby: boolean; top: number; bottom: number };
type Job = { key: string; source: CoverSource; subscribers: Set<Subscriber>; background: number; started: boolean };
const jobs = new Map<string, Job>();
const elements = new Map<Element, { job: Job; subscriber: Subscriber }>();
// HTTP/SW caching holds the full library; keep only a small decoded window.
const decoded = new Map<string, HTMLImageElement>();
const downloaded = new Map<string, Result>();
let observer: IntersectionObserver | undefined;
let network = 0;
let backgroundNetwork = 0;
let decoding = 0;
let scheduled = 0;
let listening = false;
const decodeQueue: Array<() => void> = [];

function keyFor(source: CoverSource) {
  return `${source.src}|${source.srcSet || ""}|${source.sizes}|${window.innerWidth}|${window.devicePixelRatio}`;
}
export function preparedCover(source: CoverSource): Result | null {
  return typeof window === "undefined" ? null : downloaded.get(keyFor(source)) || null;
}
export function rememberCover(source: CoverSource, image: HTMLImageElement) {
  if (!image.complete || !image.naturalWidth) return;
  const key = keyFor(source);
  downloaded.set(key, source);
  decoded.delete(key); decoded.set(key, image);
  while (decoded.size > 24) decoded.delete(decoded.keys().next().value!);
  while (downloaded.size > 1600) downloaded.delete(downloaded.keys().next().value!);
}
function schedule() {
  if (!scheduled) scheduled = window.setTimeout(() => { scheduled = 0; pump(); }, 0);
}
function observe() {
  if (observer || !("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const tracked = elements.get(entry.target);
      if (!tracked) continue;
      tracked.subscriber.nearby = entry.isIntersecting;
      const box = entry.boundingClientRect;
      tracked.subscriber.top = (box?.top || 0) + window.scrollY;
      tracked.subscriber.bottom = (box?.bottom || 0) + window.scrollY;
    }
    schedule();
  }, { rootMargin: `${3 * window.innerHeight}px 0px` });
}
function register(source: CoverSource) {
  const key = keyFor(source);
  let job = jobs.get(key);
  if (!job) { job = { key, source: { src: source.src, srcSet: source.srcSet, sizes: source.sizes }, subscribers: new Set(), background: 0, started: false }; jobs.set(key, job); }
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", schedule);
    document.addEventListener("load", schedule, true);
    document.addEventListener("error", schedule, true);
    window.addEventListener("scroll", schedule, { passive: true });
  }
  return job;
}
function nextDecode(work: () => void) {
  if (decoding < 2) { decoding++; work(); } else decodeQueue.push(work);
}
function finishDecode() {
  const next = decodeQueue.shift();
  if (next) next(); else decoding--;
  schedule();
}
function release(job: Job) {
  if (!job.background && !job.subscribers.size && !job.started) jobs.delete(job.key);
  if (!elements.size) { observer?.disconnect(); observer = undefined; }
  if (!jobs.size && listening) {
    document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("load", schedule, true);
    document.removeEventListener("error", schedule, true);
    window.removeEventListener("scroll", schedule);
    listening = false;
  }
}
function pump() {
  const limit = window.matchMedia("(pointer: coarse)").matches ? 2 : 4;
  if (network >= limit || decodeQueue.length >= 2) return;
  const y = window.scrollY;
  const height = window.innerHeight;
  const distance = (subscriber: Subscriber) => {
    const top = subscriber.top - y, bottom = subscriber.bottom - y;
    return bottom >= 0 && top <= height ? -1 : Math.min(Math.abs(top - height), Math.abs(bottom));
  };
  const waiting = [...jobs.values()].filter(job => !job.started && (job.background || [...job.subscribers].some(s => s.nearby)))
    .map(job => ({ job, distance: Math.min(...[...job.subscribers].filter(s => s.nearby).map(distance), Infinity) }))
    .sort((a, b) => a.distance - b.distance);
  const showcasePending = [...document.querySelectorAll<HTMLImageElement>("img[data-cover-eager]")].some(image => !image.complete);
  for (const { job, distance } of waiting) {
    if (network >= limit || decodeQueue.length >= 2) break;
    const background = !Number.isFinite(distance);
    if (background && (document.hidden || showcasePending || backgroundNetwork >= Math.max(1, limit - 2))) continue;
    job.started = true;
    network++;
    if (background) backgroundNetwork++;
    const image = decoded.get(job.key) || new Image();
    image.decoding = "async";
    image.fetchPriority = background ? "low" : "high";
    let settled = false;
    const timeout = window.setTimeout(() => complete(true), 20_000);
    function finish(error: boolean) {
      const result = { ...job.source, ...(error ? { error: true } : {}) };
      if (!error) {
        downloaded.set(job.key, result);
        decoded.delete(job.key); decoded.set(job.key, image);
        while (decoded.size > 24) decoded.delete(decoded.keys().next().value!);
        while (downloaded.size > 1600) downloaded.delete(downloaded.keys().next().value!);
      }
      for (const subscriber of job.subscribers) {
        observer?.unobserve(subscriber.element); elements.delete(subscriber.element);
        subscriber.done(result);
      }
      job.subscribers.clear(); jobs.delete(job.key); release(job); schedule();
    }
    function complete(error: boolean) {
      if (settled) return;
      settled = true; clearTimeout(timeout); network--; if (background) backgroundNetwork--;
      image.onload = null; image.onerror = null;
      if (error) {
        image.removeAttribute("srcset"); image.removeAttribute("src");
        finish(true); return;
      }
      nextDecode(() => { void image.decode().then(() => finish(false), () => finish(true)).finally(finishDecode); });
      schedule();
    }
    if (decoded.has(job.key)) { complete(false); continue; }
    image.onload = () => complete(false); image.onerror = () => complete(true);
    image.sizes = job.source.sizes;
    if (job.source.srcSet) image.srcset = job.source.srcSet;
    image.src = job.source.src;
  }
}

/** Visible subscribers promote the same transfer already queued by warmup. */
export function prepareCover(element: HTMLElement, source: CoverSource & { done: (result: Result) => void }) {
  const ready = preparedCover(source);
  if (ready) { source.done(ready); return () => {}; }
  const job = register(source);
  const subscriber = { element, done: source.done, nearby: !("IntersectionObserver" in window), top: 0, bottom: 0 };
  job.subscribers.add(subscriber); elements.set(element, { job, subscriber });
  observe(); observer?.observe(element); schedule();
  return () => {
    job.subscribers.delete(subscriber); elements.delete(element); observer?.unobserve(element); release(job);
  };
}

/** Downloads continue for collapsed cards without mounting a hidden React tree.
 * Two desktop slots / one touch slot remain available for visible requests. */
export function warmCovers(sources: CoverSource[]) {
  const owned = sources.filter(source => !preparedCover(source)).map(source => register(source));
  owned.forEach(job => { job.background++; }); schedule();
  return () => { owned.forEach(job => { job.background--; release(job); }); };
}
