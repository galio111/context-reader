// Prioritize visible pages and keep background rasterization from monopolizing
// the browser when a zoom change invalidates several neighbouring pages.
let active = 0;
const waiting: { priority: number; start: () => void }[] = [];
function drain() {
  waiting.sort((a, b) => a.priority - b.priority);
  // Prepare distant pages one at a time: two image-heavy background downloads
  // divide the uplink and delay the next page the person will actually read.
  // A newly visible page may use the second slot immediately.
  while (waiting.length && active < (waiting[0].priority === 0 ? 2 : 1)) waiting.shift()!.start();
}
export function acquirePdfRender(signal: AbortSignal, priority: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      const index = waiting.indexOf(job);
      if (index >= 0) waiting.splice(index, 1);
      reject(new DOMException("Render superseded", "AbortError"));
    };
    const job = { priority, start: () => {
      signal.removeEventListener("abort", aborted);
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true; active--;
        drain();
      });
    } };
    if (signal.aborted) { aborted(); return; }
    waiting.push(job); signal.addEventListener("abort", aborted, { once: true });
    drain();
  });
}
