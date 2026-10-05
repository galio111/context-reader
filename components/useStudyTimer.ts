"use client";
import { useEffect, useRef } from "react";
export function useStudyTimer(enabled: boolean, identity: string) {
  const elapsed = useRef(0);
  useEffect(() => { elapsed.current = 0; }, [identity]);
  useEffect(() => {
    if (!enabled) return;
    let last = performance.now(), active = last;
    const touch = () => { active = performance.now(); };
    const tick = () => {
      const now = performance.now();
      if (document.visibilityState === "visible" && document.hasFocus() && now-active<30000) elapsed.current += Math.min(1000,now-last);
      last = now;
    };
    const timer = window.setInterval(tick,500);
    for (const e of ["pointerdown","pointermove","keydown","touchstart","focus"]) window.addEventListener(e,touch,{passive:true});
    return () => { tick(); window.clearInterval(timer); for (const e of ["pointerdown","pointermove","keydown","touchstart","focus"]) window.removeEventListener(e,touch); };
  },[enabled,identity]);
  return () => Math.min(60000,Math.round(elapsed.current));
}
