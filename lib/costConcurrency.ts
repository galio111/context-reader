interface ConcurrencyState {
  active: Map<string, number>;
  waiting: Map<string, Array<() => boolean>>;
}

const globalConcurrency = globalThis as typeof globalThis & {
  __contextReaderConcurrency?: ConcurrencyState;
};

const state = globalConcurrency.__contextReaderConcurrency ?? { active: new Map<string, number>(), waiting: new Map<string, Array<() => boolean>>() };
state.waiting ??= new Map();
globalConcurrency.__contextReaderConcurrency = state;

export class CostCapacityError extends Error {
  constructor() {
    super("Costly operation concurrency limit reached.");
    this.name = "CostCapacityError";
  }
}

export function acquireCostSlot(bucket: string, limit: number): (() => void) | null {
  const current = state.active.get(bucket) ?? 0;
  if (current >= limit) {
    return null;
  }
  state.active.set(bucket, current + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const active = state.active.get(bucket) ?? 1;
    if (active <= 1) {
      state.active.delete(bucket);
    } else {
      state.active.set(bucket, active - 1);
    }
    const queue = state.waiting.get(bucket);
    while (queue?.length && queue[0]()) { /* each admitted waiter removes itself */ }
  };
}

export async function acquireCostSlotWithWait(
  bucket: string,
  limit: number,
  options: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number; maxQueued?: number } = {},
): Promise<(() => void) | null> {
  if (options.signal?.aborted) return null;
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const queue = state.waiting.get(bucket) ?? [];
  if (!queue.length) {
    const release = acquireCostSlot(bucket, limit);
    if (release) return release;
  }
  if (!timeoutMs || queue.length >= (options.maxQueued ?? 64)) return null;
  state.waiting.set(bucket, queue);
  return new Promise(resolve => {
    let settled = false;
    const finish = (release: (() => void) | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", aborted);
      const index = queue.indexOf(attempt);
      if (index !== -1) queue.splice(index, 1);
      if (!queue.length) state.waiting.delete(bucket);
      resolve(release);
    };
    const attempt = () => {
      if (options.signal?.aborted) { finish(null); return true; }
      const release = acquireCostSlot(bucket, limit);
      if (!release) return false;
      finish(release);
      return true;
    };
    const aborted = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    queue.push(attempt);
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (options.signal?.aborted) aborted();
  });
}

/** Single-process budget: interactive work shares 16 slots; long work may occupy at most 4. */
export async function acquireAiSlot(signal: AbortSignal, background = false): Promise<(() => void) | null> {
  const configured = Number(process.env.AI_MAX_CONCURRENCY || 16);
  const limit = Number.isFinite(configured) ? Math.max(4, Math.min(32, Math.floor(configured))) : 16;
  const backgroundRelease = background
    ? await acquireCostSlotWithWait("ai-background", Math.min(4, Math.max(1, Math.floor(limit / 4))), { signal, timeoutMs: 8_000, maxQueued: 16 })
    : undefined;
  if (background && !backgroundRelease) return null;
  const release = await acquireCostSlotWithWait("ai", limit, { signal, timeoutMs: background ? 8_000 : 2_500, maxQueued: 48 });
  if (!release) { backgroundRelease?.(); return null; }
  return () => { release(); backgroundRelease?.(); };
}

export async function withCostSlot<T>(bucket: string, limit: number, task: () => Promise<T>): Promise<T> {
  const release = acquireCostSlot(bucket, limit);
  if (!release) {
    throw new CostCapacityError();
  }
  try {
    return await task();
  } finally {
    release();
  }
}
