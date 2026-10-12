"use client";
import { useEffect } from "react";

export function useAccountActivity(owner: string, enabled: boolean) {
  useEffect(() => {
    if (!owner || !enabled) return;
    let recorded = "", pending = false;
    const record = () => {
      const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      if (document.visibilityState !== "visible" || !document.hasFocus() || pending || recorded === day) return;
      pending = true;
      void fetch("/api/account/activity", { method: "POST", headers: { "X-Context-Account": owner }, keepalive: true })
        .then(response => { if (response.ok) recorded = day; }).catch(() => {}).finally(() => { pending = false; });
    };
    record();
    document.addEventListener("visibilitychange", record); window.addEventListener("focus", record);
    const timer = window.setInterval(record, 60_000);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", record); window.removeEventListener("focus", record); };
  }, [owner, enabled]);
}
