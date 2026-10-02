"use client";
import { startTransition, useEffect, useState } from "react";

const CHUNK = 36;

/** Keep the complete searchable catalogue, but split the expensive DOM commits.
 * The first chunk extends several screens past the expansion button. */
export function usePublicationMountCount(key: string, total: number, minimum = 0) {
  const initial = Math.min(total, Math.max(CHUNK, minimum));
  const [progress, setProgress] = useState({ key, count: initial });
  const count = progress.key === key ? Math.max(initial, progress.count) : initial;
  useEffect(() => {
    if (count >= total) return;
    const append = () => startTransition(() => setProgress({ key, count: Math.min(total, count + CHUNK) }));
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(append, { timeout: 120 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(append, 32);
    return () => window.clearTimeout(timer);
  }, [key, total, count]);
  return count;
}
