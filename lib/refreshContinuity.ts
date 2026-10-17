"use client";

// Tab-local presentation only. Never used as authentication or learning history.
export function isRefreshNavigation(): boolean {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === "reload" || navigation?.type === "back_forward";
}

export function readRefreshState<T>(key: string, owner: string, consume = false): T | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`context-reader:refresh:${key}`) || "null");
    if (consume) sessionStorage.removeItem(`context-reader:refresh:${key}`);
    return value?.owner === owner && value?.version === 1 ? value.state as T : null;
  } catch { return null; }
}

export function writeRefreshState(key: string, owner: string, state: unknown): void {
  try {
    sessionStorage.setItem(`context-reader:refresh:${key}`, JSON.stringify({ version: 1, owner, state }));
  } catch { /* Storage restrictions must not interrupt the current task. */ }
}
