"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export const MOBILE_SHEET_DEFAULT_HEIGHT = 56;
export const MOBILE_SHEET_TALL_HEIGHT = 76;
export const MOBILE_SHEET_MAX_HEIGHT = 82;
export const MOBILE_SHEET_MIN_HEIGHT = 25;
export const MOBILE_READER_SHEET_HEIGHT = 48;
export const MOBILE_SHEET_FLICK_DISTANCE = 28;
export const MOBILE_SHEET_DISMISS_VELOCITY = 0.62;

export function clampMobileSheetHeight(height: number): number {
  return Math.min(MOBILE_SHEET_MAX_HEIGHT, Math.max(MOBILE_SHEET_MIN_HEIGHT, height));
}

interface ResizeInteraction {
  pointerId: number;
  startY: number;
  startHeight: number;
  viewportHeight: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
}

export function shouldDismissMobileSheet(height: number, distance: number, velocity: number): boolean {
  return height < MOBILE_SHEET_MIN_HEIGHT
    || (distance >= MOBILE_SHEET_FLICK_DISTANCE && velocity >= MOBILE_SHEET_DISMISS_VELOCITY);
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
    if (!event.isPrimary || event.button !== 0 || resizeRef.current) return;
    const now = performance.now();
    resizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      viewportHeight: window.innerHeight,
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
    const nextHeight = interaction.startHeight - deltaY / interaction.viewportHeight * 100;
    setHeight(clampMobileSheetHeight(nextHeight));
    // Below the minimum, keep the handle following the finger until release.
    setDragOffset(Math.max(0, MOBILE_SHEET_MIN_HEIGHT - nextHeight) / 100 * interaction.viewportHeight);
  }, []);

  const finishResize = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const interaction = resizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    const distance = Math.max(0, event.clientY - interaction.startY);
    const nextHeight = interaction.startHeight - (event.clientY - interaction.startY) / interaction.viewportHeight * 100;
    // A fast move followed by a pause is a resize, not a fling.
    const velocity = performance.now() - interaction.lastAt <= 80 ? interaction.velocityY : 0;
    if (!cancelled && dismissRef.current && shouldDismissMobileSheet(nextHeight, distance, velocity)) {
      setDragOffset(typeof window === "undefined" ? distance : Math.max(distance, window.innerHeight));
      dismissRef.current();
      return;
    }
    setHeight(clampMobileSheetHeight(cancelled ? interaction.startHeight : nextHeight));
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
