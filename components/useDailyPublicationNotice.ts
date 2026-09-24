"use client";
import { useEffect, useRef, useState } from "react";
import { shanghaiDay, VisibleNoticeClock } from "@/lib/dailyPublicationUpdates";

import { startupMark } from "@/lib/startupPerformance";

const pageSeen = new Set<string>();
export function useDailyPublicationNotice(userId: string | undefined, enabled: boolean, unobstructed: boolean) {
  const [day, setDay] = useState(() => shanghaiDay());
  const [result, setResult] = useState<{ key: string; count: number } | null>(null);
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const available = useRef(unobstructed);
  available.current = unobstructed;
  const key = userId ? `context-reader:daily-update:${userId}` : "";
  const identity = `${key}:${day}`;
  useEffect(() => {
    const update = () => setDay(shanghaiDay());
    const interval = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    setResult(null); setShown(false);
    if (!enabled || !key || pageSeen.has(identity)) return;
    try { if (localStorage.getItem(key) === day) return; } catch { /* pageSeen is the fallback. */ }
    const controller = new AbortController();
    void fetch("/api/public-articles/daily-updates", { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const value = await response.json();
      if (!controller.signal.aborted && value.day === day && Number.isInteger(value.count) && value.count >= 0) setResult({ key: identity, count: value.count });
    }).catch(() => { /* Unknown count is never presented as zero. */ });
    return () => controller.abort();
  }, [enabled, key, identity, day]);
  useEffect(() => {
    if (!result || result.key !== identity) return;
    const clock = new VisibleNoticeClock();
    let frame = 0, claimed = false, complete = false, painted = false;
    const seenElsewhere = () => { try { return localStorage.getItem(key) === day; } catch { return false; } };
    const tick = (now: number) => {
      if (complete) return;
      if (!claimed && (pageSeen.has(identity) || seenElsewhere())) { setShown(false); return; }
      const visible = document.visibilityState === "visible" && available.current;
      setShown(visible);
      const element = ref.current;
      const rendered = visible && Boolean(element && element.getBoundingClientRect().height > 0);
      if (rendered && painted && !claimed) {
        claimed = true; pageSeen.add(identity); startupMark("notice-visible");
        try { localStorage.setItem(key, day); } catch { /* Browser-local lifecycle fallback. */ }
      }
      if (clock.tick(now, rendered && painted)) { complete = true; startupMark("notice-complete"); setShown(false); return; }
      painted = rendered;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [result, identity, key, day]);
  return { day, ref, count: enabled && unobstructed && shown && result?.key === identity ? result.count : null };
}
