// Prioritize visible pages and keep background rasterization from monopolizing
// the browser when a zoom change invalidates several neighbouring pages.
let active = 0;
const waiting: { priority: number; start: () => void }[] = [];
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
        waiting.sort((a, b) => a.priority - b.priority);
        waiting.shift()?.start();
      });
    } };
    if (signal.aborted) { aborted(); return; }
    if (active < 2) job.start();
    else { waiting.push(job); signal.addEventListener("abort", aborted, { once: true }); }
  });
}
