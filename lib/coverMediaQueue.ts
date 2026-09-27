type Result = { src: string; srcSet?: string; sizes: string; error?: boolean };
type Job = { element: HTMLElement; src: string; srcSet?: string; sizes: string; done: (result: Result) => void; nearby: boolean; started: boolean; cancelled: boolean };
const jobs = new Set<Job>();
const decoded = new Map<string, HTMLImageElement>();
let observer: IntersectionObserver | undefined;
let network = 0;
let decoding = 0;
const decodeQueue: Array<() => void> = [];
let elapsedEstimate = 2200; // Initial direct-network cover sample: 1.9–2.3 s.
let velocity = 0;
let lastY = 0;
let lastTime = 0;
let margin = 0;
let tick = 0;

function nextDecode(work: () => void) {
  if (decoding < 2) { decoding++; work(); } else decodeQueue.push(work);
}
function finishDecode() {
  const next = decodeQueue.shift();
  if (next) next(); else decoding--;
  pump();
}
function configureObserver() {
  const h = window.innerHeight;
  const nextMargin = Math.round(Math.min(3 * h, Math.max(2 * h, Math.abs(velocity) * elapsedEstimate + h)) / 200) * 200;
  if (observer && nextMargin === margin) return;
  margin = nextMargin;
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) for (const job of jobs) {
      if (job.element === entry.target) job.nearby = entry.isIntersecting;
    }
    pump();
  }, { rootMargin: `${margin}px 0px` });
  for (const job of jobs) observer.observe(job.element);
}
function onScroll() {
  if (tick) return;
  tick = window.setTimeout(() => {
    tick = 0;
    const now = performance.now();
    velocity = (window.scrollY - lastY) / Math.max(1, now - lastTime);
    lastY = window.scrollY; lastTime = now;
    configureObserver(); pump();
  }, 120);
}
function pump() {
  const limit = window.matchMedia("(pointer: coarse)").matches ? 2 : 4;
  const h = window.innerHeight;
  const waiting = [...jobs].filter(j => j.nearby && !j.started && !j.cancelled)
    .map(job => {
      const box = job.element.getBoundingClientRect();
      const distance = box.bottom >= 0 && box.top <= h ? -1 : Math.min(Math.abs(box.top - h), Math.abs(box.bottom));
      return { job, distance };
    }).sort((a, b) => a.distance - b.distance);
  for (const { job } of waiting) {
    if (network >= limit || decodeQueue.length >= 4) break;
    job.started = true; network++;
    const start = performance.now();
    const key = `${job.src}|${job.srcSet || ""}|${job.sizes}|${window.devicePixelRatio}`;
    const image = decoded.get(key) || new Image();
    image.decoding = "async";
    let settled = false;
    const timeout = window.setTimeout(() => complete(true), 20_000);
    function complete(error: boolean) {
      if (settled) return;
      settled = true; clearTimeout(timeout); network--; image.onload = null; image.onerror = null;
      if (error) {
        // Cancel the timed-out transfer before releasing its network slot.
        image.removeAttribute("srcset"); image.removeAttribute("src");
        if (!job.cancelled) job.done({ src: job.src, srcSet: job.srcSet, sizes: job.sizes, error: true });
        pump(); return;
      }
      nextDecode(() => {
        image.decode().then(() => {
          elapsedEstimate = elapsedEstimate * .75 + (performance.now() - start) * .25;
          decoded.delete(key); decoded.set(key, image);
          while (decoded.size > 24) decoded.delete(decoded.keys().next().value!);
          if (!job.cancelled) job.done({ src: job.src, srcSet: job.srcSet, sizes: job.sizes });
        }).catch(() => {
          if (!job.cancelled) job.done({ src: job.src, srcSet: job.srcSet, sizes: job.sizes, error: true });
        }).finally(finishDecode);
      });
      pump();
    }
    if (decoded.has(key)) { complete(false); continue; }
    image.onload = () => complete(false);
    image.onerror = () => complete(true);
    image.sizes = job.sizes;
    if (job.srcSet) image.srcset = job.srcSet;
    image.src = job.src;
  }
}

/** All noncritical cover requests enter here; JSX receives URLs only after decode. */
export function prepareCover(element: HTMLElement, source: Omit<Job, "element" | "nearby" | "started" | "cancelled">) {
  const job: Job = { ...source, element, nearby: false, started: false, cancelled: false };
  jobs.add(job);
  if (jobs.size === 1) {
    lastY = window.scrollY; lastTime = performance.now();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }
  configureObserver(); observer?.observe(element);
  return () => {
    job.cancelled = true; jobs.delete(job); observer?.unobserve(element);
    if (!jobs.size) {
      observer?.disconnect(); observer = undefined;
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      clearTimeout(tick); tick = 0;
    }
  };
}
