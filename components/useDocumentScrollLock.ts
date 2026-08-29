"use client";

import { useEffect } from "react";

interface ScrollLockSnapshot {
  scrollX: number;
  scrollY: number;
  documentOverflow: string;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyWidth: string;
  bodyPaddingRight: string;
}

let activeLocks = 0;
let snapshot: ScrollLockSnapshot | null = null;

function acquireDocumentScrollLock(): () => void {
  const body = document.body;
  const documentElement = document.documentElement;

  if (activeLocks === 0) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);
    snapshot = {
      scrollX,
      scrollY,
      documentOverflow: documentElement.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
    };

    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.width = "100%";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  }

  activeLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks !== 0 || !snapshot) return;

    const previous = snapshot;
    snapshot = null;
    documentElement.style.overflow = previous.documentOverflow;
    body.style.overflow = previous.bodyOverflow;
    body.style.position = previous.bodyPosition;
    body.style.top = previous.bodyTop;
    body.style.left = previous.bodyLeft;
    body.style.width = previous.bodyWidth;
    body.style.paddingRight = previous.bodyPaddingRight;
    window.scrollTo(previous.scrollX, previous.scrollY);
  };
}

export function useDocumentScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireDocumentScrollLock();
  }, [active]);
}
