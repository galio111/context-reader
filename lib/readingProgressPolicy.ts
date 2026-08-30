import type { ReaderViewportActivity } from "@/types/reader";

export const READING_PROGRESS_STABLE_DWELL_MS = 8_000;
export const READER_RAPID_SCROLL_MIN_VIEWPORT_RATIO = 0.85;
export const READER_RAPID_SCROLL_MAX_DURATION_MS = 1_200;
export const READER_BOTTOM_THRESHOLD_PX = 64;

export function usesSavedArticleRestartPolicy(originKind: string): boolean {
  return originKind === "saved-article";
}

export function isRapidReaderScroll(distance: number, durationMs: number, viewportHeight: number): boolean {
  return distance >= viewportHeight * READER_RAPID_SCROLL_MIN_VIEWPORT_RATIO
    && durationMs <= READER_RAPID_SCROLL_MAX_DURATION_MS;
}

export function isReaderAtBottom(scrollHeight: number, scrollY: number, viewportHeight: number): boolean {
  return scrollHeight - (scrollY + viewportHeight) <= READER_BOTTOM_THRESHOLD_PX;
}

export function stableViewportDuration(activity: ReaderViewportActivity, now = Date.now()): number {
  return activity.settledAt > 0 ? Math.max(0, now - activity.settledAt) : 0;
}

export function shouldRestartSavedArticleOnExit(
  activity: ReaderViewportActivity,
  rapidScanPending: boolean,
  now = Date.now(),
): boolean {
  const stableFor = stableViewportDuration(activity, now);
  const completedAtBottom = activity.atBottom && stableFor >= READING_PROGRESS_STABLE_DWELL_MS;
  const unrecoveredRapidScan = (rapidScanPending || activity.rapidScroll)
    && stableFor < READING_PROGRESS_STABLE_DWELL_MS;
  return completedAtBottom || unrecoveredRapidScan;
}
