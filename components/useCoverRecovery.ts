"use client";
import { useCallback, useEffect, useState } from "react";

const RETRY_DELAYS = [1_000, 3_000];
type State = { url: string | undefined; attempts: number; failed: boolean; revision: number };

/** One initial load and two silent retries; a real reconnect opens a fresh cycle. */
export function useCoverRecovery(url: string | undefined) {
  const [state, setState] = useState<State>({ url, attempts: 0, failed: false, revision: 0 });
  const current = state.url === url ? state : { url, attempts: 0, failed: false, revision: 0 };
  const fail = useCallback(() => setState(previous => previous.url === url
    ? { ...previous, failed: true }
    : { url, attempts: 0, failed: true, revision: 0 }), [url]);
  const recover = useCallback(() => setState(previous => previous.url === url
    ? { ...previous, failed: false }
    : { url, attempts: 0, failed: false, revision: 0 }), [url]);

  useEffect(() => {
    if (!current.failed || current.attempts >= RETRY_DELAYS.length) return;
    const timer = window.setTimeout(() => setState(previous => previous.url === url && previous.failed
      ? { ...previous, failed: false, attempts: previous.attempts + 1, revision: previous.revision + 1 }
      : previous), RETRY_DELAYS[current.attempts]);
    return () => window.clearTimeout(timer);
  }, [url, current.failed, current.attempts]);

  useEffect(() => {
    const online = () => setState(previous => previous.url === url && previous.failed
      ? { ...previous, failed: false, attempts: 0, revision: previous.revision + 1 }
      : previous);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [url]);

  return { failed: current.failed, exhausted: current.failed && current.attempts >= RETRY_DELAYS.length,
    revision: current.revision, fail, recover };
}
