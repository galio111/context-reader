"use client";

const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notifyLookupCancellation(actionId: string): void {
  if (typeof window === "undefined" || !ACTION_ID_PATTERN.test(actionId)) return;
  if (navigator.sendBeacon?.("/api/lookup-cancel", actionId)) return;
  void fetch("/api/lookup-cancel", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: actionId,
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}
