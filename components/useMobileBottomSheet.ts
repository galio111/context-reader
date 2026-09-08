"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export const MOBILE_SHEET_DEFAULT_HEIGHT = 56;
export const MOBILE_SHEET_TALL_HEIGHT = 76;
export const MOBILE_SHEET_MAX_HEIGHT = 82;
export const MOBILE_SHEET_MIN_HEIGHT = 40;
export const MOBILE_READER_SHEET_HEIGHT = 48;
export const MOBILE_SHEET_DISMISS_DISTANCE = 96;
export const MOBILE_SHEET_DISMISS_VELOCITY = 0.62;

export function clampMobileSheetHeight(height: number): number {
  return Math.min(MOBILE_SHEET_MAX_HEIGHT, Math.max(MOBILE_SHEET_MIN_HEIGHT, height));
}

interface ResizeInteraction {
  pointerId: number;
  startY: number;
  startHeight: number;
  startedAt: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
}

export function shouldDismissMobileSheet(distance: number, velocity: number): boolean {
  return distance >= MOBILE_SHEET_DISMISS_DISTANCE
    || (distance >= 28 && velocity >= MOBILE_SHEET_DISMISS_VELOCITY);
}

export function useMobileBottomSheet(
  open: boolean,
  resetKey?: unknown,
  initialHeight = MOBILE_SHEET_DEFAULT_HEIGHT,
  onDismiss?: () => void,
) {
  const [height, setHeight] = useState(() => clampMobileSheetHeight(initialHeight));
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const resizeRef = useRef<ResizeInteraction | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    setHeight(clampMobileSheetHeight(initialHeight));
    setDragOffset(0);
    setDragging(false);
    resizeRef.current = null;
  }, [initialHeight, open, resetKey]);

  const onResizeStart = useCallback((event: PointerEvent<HTMLElement>) => {
    const now = performance.now();
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      startedAt: now,
      lastY: event.clientY,
      lastAt: now,
      velocityY: 0,
    };
    setDragging(true);
    setDragOffset(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [height]);

  const onResizeMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const interaction = resizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || typeof window === "undefined") return;
    const now = performance.now();
    const elapsed = Math.max(1, now - interaction.lastAt);
    interaction.velocityY = (event.clientY - interaction.lastY) / elapsed;
    interaction.lastY = event.clientY;
    interaction.lastAt = now;
    const deltaY = event.clientY - interaction.startY;
    if (deltaY > 0) {
      setDragOffset(deltaY);
      setHeight(interaction.startHeight);
      return;
    }
    setDragOffset(0);
    const deltaHeight = (-deltaY / window.innerHeight) * 100;
    setHeight(clampMobileSheetHeight(interaction.startHeight + deltaHeight));
  }, []);

  const finishResize = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const interaction = resizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    const distance = Math.max(0, event.clientY - interaction.startY);
    if (!cancelled && dismissRef.current && shouldDismissMobileSheet(distance, interaction.velocityY)) {
      setDragOffset(typeof window === "undefined" ? distance : Math.max(distance, window.innerHeight));
      dismissRef.current();
      return;
    }
    setDragOffset(0);
  }, []);

  const onResizeEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    finishResize(event, false);
  }, [finishResize]);

  const onResizeCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    finishResize(event, true);
  }, [finishResize]);

  return { height, dragOffset, dragging, onResizeStart, onResizeMove, onResizeEnd, onResizeCancel };
}
