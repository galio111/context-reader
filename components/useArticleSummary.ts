"use client";
import { useEffect, useRef, useState } from "react";
export function useArticleSummary(resetKey: string) {
  const [summary, setSummary] = useState<{ id: string; text: string; left: number; top: number; above: boolean; width: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function close() { if (timer.current) clearTimeout(timer.current); timer.current = null; setSummary(null); }
  function hide() { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setSummary(null), 120); }
  function show(id: string, text: string, anchor: HTMLElement, keyboard = false) {
    if (!text.trim() || (!keyboard && !matchMedia("(hover:hover) and (pointer:fine)").matches)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!anchor.isConnected) return;
      const r = anchor.getBoundingClientRect(), width = Math.min(320, innerWidth - 24);
      const above = r.bottom + 150 > innerHeight;
      setSummary({ id, text: text.trim(), left: Math.max(12, Math.min(r.left, innerWidth - width - 12)), top: above ? r.top - 8 : r.bottom + 8, above, width });
    }, 220);
  }
  useEffect(() => {
    const dismiss = () => { if (timer.current) clearTimeout(timer.current); setSummary(null); };
    dismiss();
    window.addEventListener("scroll", dismiss, true); window.addEventListener("resize", dismiss);
    return () => { dismiss(); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); };
  }, [resetKey]);
  return { summary, show, hide, close };
}
