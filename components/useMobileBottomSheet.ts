"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export const MOBILE_SHEET_DEFAULT_HEIGHT = 56;
export const MOBILE_SHEET_TALL_HEIGHT = 76;
export const MOBILE_SHEET_MAX_HEIGHT = 82;
export const MOBILE_SHEET_MIN_HEIGHT = 40;

export function clampMobileSheetHeight(height: number): number {
  return Math.min(MOBILE_SHEET_MAX_HEIGHT, Math.max(MOBILE_SHEET_MIN_HEIGHT, height));
}

interface ResizeInteraction {
  pointerId: number;
  startY: number;
  startHeight: number;
}

export function useMobileBottomSheet(open: boolean, resetKey?: unknown, initialHeight = MOBILE_SHEET_DEFAULT_HEIGHT) {
  const [height, setHeight] = useState(() => clampMobileSheetHeight(initialHeight));
  const resizeRef = useRef<ResizeInteraction | null>(null);

  useEffect(() => {
    if (open) setHeight(clampMobileSheetHeight(initialHeight));
  }, [initialHeight, open, resetKey]);

  const onResizeStart = useCallback((event: PointerEvent<HTMLElement>) => {
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [height]);

  const onResizeMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const interaction = resizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || typeof window === "undefined") return;
    const deltaHeight = ((interaction.startY - event.clientY) / window.innerHeight) * 100;
    setHeight(clampMobileSheetHeight(interaction.startHeight + deltaHeight));
  }, []);

  const onResizeEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    const interaction = resizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return { height, onResizeStart, onResizeMove, onResizeEnd };
}
