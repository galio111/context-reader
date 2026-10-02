/** Smooth transport bursts without delaying the request or inventing content. */
export function createTextReveal(options: {
  write: (text: string) => void;
  signal: AbortSignal;
  immediate?: () => boolean;
  now?: () => number;
  schedule?: (callback: () => void) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? (callback => setTimeout(callback, 24));
  const cancel = options.cancel ?? clearTimeout;
  let target = "", shown = "", deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const waiters = new Set<() => void>();
  const settle = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const tick = () => {
    timer = undefined;
    if (disposed || options.signal.aborted) { settle(); return; }
    const remaining = target.length - shown.length;
    const count = options.immediate?.() ? remaining
      : Math.max(4, Math.ceil(remaining * 24 / Math.max(24, deadline - now())));
    let end = Math.min(target.length, shown.length + count);
    // Never display half of a UTF-16 surrogate pair.
    if (end < target.length && /[\uD800-\uDBFF]/.test(target[end - 1] ?? "")) end++;
    shown = target.slice(0, end);
    options.write(shown);
    if (shown.length < target.length) timer = schedule(tick);
    else { deadline = 0; settle(); }
  };
  const update = (value: string) => {
    if (disposed || options.signal.aborted) return;
    target = value;
    // Structured repair may correct earlier fields. Keep the already visible
    // extent, and reveal the remaining result through the same queue.
    if (!target.startsWith(shown)) {
      shown = target.slice(0, Math.min(shown.length, target.length));
      options.write(shown);
    }
    if (!deadline) deadline = now() + 720;
    if (timer === undefined) timer = schedule(tick);
  };
  const dispose = () => {
    disposed = true;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    options.signal.removeEventListener("abort", dispose);
    settle();
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  return {
    append: (chunk: string) => update(target + chunk),
    finish: (value?: string): Promise<void> => {
      if (value !== undefined) update(value);
      if (disposed || options.signal.aborted || shown === target) return Promise.resolve();
      return new Promise(resolve => waiters.add(resolve));
    },
    dispose,
  };
}
