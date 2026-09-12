/** Stream only rerenders subscribed explanation panels, never the article canvas. */
export function createExplanationStreamStore() {
  let text = "";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => text,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setText: (value: string | ((previous: string) => string)) => {
      const next = typeof value === "function" ? value(text) : value;
      if (next === text) return;
      text = next;
      for (const listener of listeners) listener();
    },
  };
}

export type ExplanationStreamStore = ReturnType<typeof createExplanationStreamStore>;

const foregroundLookups = new Set<symbol>();
export const hasForegroundLookup = () => foregroundLookups.size > 0;
export function beginForegroundLookup(signal: AbortSignal): () => void {
  const token = Symbol();
  const finish = () => {
    foregroundLookups.delete(token);
    signal.removeEventListener("abort", finish);
  };
  if (!signal.aborted) {
    foregroundLookups.add(token);
    signal.addEventListener("abort", finish, { once: true });
  }
  return finish;
}
