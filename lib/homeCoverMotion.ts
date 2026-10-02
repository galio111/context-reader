/** Viewport geometry remains valid when Menu fixes the body and scrollY becomes zero. */
export function updateHomeCoverMotion(
  flow: HTMLElement | null,
  stage: HTMLElement | null,
  showcase: HTMLElement | null,
  setDeparture: (progress: number) => void,
): number {
  const stageTop = stage?.getBoundingClientRect().top;
  const showcaseTop = showcase?.getBoundingClientRect().top;
  // Missing/temporarily detached geometry must never expose a full-window canvas.
  const raw = stageTop === undefined || showcaseTop === undefined
    ? 1
    : Math.min(1, Math.max(0, -stageTop / Math.max(1, showcaseTop - stageTop)));
  const departure = Math.min(1, Math.max(0, (raw - 0.04) / 0.96));
  if (flow) {
    flow.style.setProperty("--cover-progress", raw.toFixed(4));
    flow.style.setProperty("--hero-opacity", Math.max(0, 1 - raw * 2.7).toFixed(4));
    flow.style.setProperty("--hero-shift", `${(raw * -34).toFixed(2)}px`);
    flow.style.setProperty("--cover-surface-opacity", Math.min(1, Math.max(0, (1 - raw) / 0.18)).toFixed(4));
    flow.style.setProperty("--hero-pointer", raw > 0.94 ? "none" : "auto");
    // An ancestor opacity gate cannot be undone by a newly mounted canvas's visibility.
    flow.style.setProperty("--cover-balls-visible", departure >= 0.985 ? "0" : "1");
  }
  setDeparture(departure);
  return raw;
}
