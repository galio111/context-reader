"use client";

import { useEffect, useRef, useState } from "react";

function canConsumeVerticalScroll(target: EventTarget | null, root: HTMLElement, deltaY: number): boolean {
  let element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  while (element && root.contains(element)) {
    const style = window.getComputedStyle(element);
    const scrollable = /^(?:auto|scroll|overlay)$/.test(style.overflowY)
      && element.scrollHeight > element.clientHeight + 1;
    if (scrollable) {
      if (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true;
      if (deltaY < 0 && element.scrollTop > 1) return true;
    }
    if (element === root) break;
    element = element.parentElement;
  }
  return false;
}

/**
 * Keeps a gesture that starts inside a mobile sheet inside that sheet. The
 * exposed article above the sheet remains ordinary document scroll territory;
 * an empty sheet or a sheet edge never chains the gesture into the article.
 */
export function useMobileSheetScrollBoundary() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const lastTouchYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!root) return;

    const onWheel = (event: globalThis.WheelEvent) => {
      event.stopPropagation();
      if (!canConsumeVerticalScroll(event.target, root, event.deltaY)) event.preventDefault();
    };
    const onTouchStart = (event: globalThis.TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      const previousY = lastTouchYRef.current;
      lastTouchYRef.current = currentY ?? null;
      event.stopPropagation();
      if (currentY === undefined || previousY === null) {
        event.preventDefault();
        return;
      }
      const deltaY = previousY - currentY;
      if (!canConsumeVerticalScroll(event.target, root, deltaY)) event.preventDefault();
    };
    const onTouchEnd = () => {
      lastTouchYRef.current = null;
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [root]);

  return setRoot;
}
