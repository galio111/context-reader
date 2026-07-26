interface ConcurrencyState {
  active: Map<string, number>;
}

const globalConcurrency = globalThis as typeof globalThis & {
  __contextReaderConcurrency?: ConcurrencyState;
};

const state = globalConcurrency.__contextReaderConcurrency ?? { active: new Map<string, number>() };
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
  };
}

export async function acquireCostSlotWithWait(
  bucket: string,
  limit: number,
  options: { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<(() => void) | null> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 150);
  const deadline = Date.now() + timeoutMs;

  while (!options.signal?.aborted) {
    const release = acquireCostSlot(bucket, limit);
    if (release) {
      return release;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
  }

  return null;
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
