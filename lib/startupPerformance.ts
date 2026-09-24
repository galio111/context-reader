/** Opt-in local diagnostics. Contains timings only, never account or article data. */
export function startupMark(name: string) {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("cr-perf")) return;
  performance.mark(`cr-startup:${name}`);
}
