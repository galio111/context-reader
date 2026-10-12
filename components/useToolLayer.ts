"use client";
import { useId, useLayoutEffect, useSyncExternalStore } from "react";

const layers: string[] = [];
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision++; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;

/** The last opened or explicitly focused tool owns the top layer and Escape. */
export function useToolLayer(open: boolean) {
  const id = useId();
  useSyncExternalStore(subscribe, snapshot, () => 0);
  const bringToFront = () => {
    if (!open || layers.at(-1) === id) return;
    const index = layers.indexOf(id); if (index >= 0) layers.splice(index, 1);
    layers.push(id); notify();
  };
  useLayoutEffect(() => {
    if (!open) return;
    layers.push(id); notify();
    return () => { const index = layers.indexOf(id); if (index >= 0) layers.splice(index, 1); notify(); };
  }, [open, id]);
  return { zIndex: 80 + Math.max(0, layers.indexOf(id)) * 2, isTop: layers.at(-1) === id, bringToFront };
}
