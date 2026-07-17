"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./OptionWheel.module.css";

interface WheelConfig {
  count: number;
  items: string[];
  rowHeight: number;
  curve: number;
  tilt: number;
  blur: number;
  fade: number;
  minOpacity: number;
  side: "left" | "right";
  loop: boolean;
  smoothing: number;
  draggable: boolean;
}

export interface OptionWheelProps {
  items: string[];
  defaultSelected?: number;
  onChange?: (index: number, item: string) => void;
  onActivate?: (index: number, item: string) => void;
  onItemHover?: (index: number | null) => void;
  textColor?: string;
  activeColor?: string;
  side?: "left" | "right";
  fontSize?: number;
  spacing?: number;
  curve?: number;
  tilt?: number;
  blur?: number;
  fade?: number;
  minOpacity?: number;
  smoothing?: number;
  inset?: number;
  loop?: boolean;
  draggable?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}

function normalizeIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  return ((Math.round(value) % count) + count) % count;
}

export function OptionWheel({
  items,
  defaultSelected = 0,
  onChange,
  onActivate,
  onItemHover,
  textColor = "#8fa1ad",
  activeColor = "#ffffff",
  side = "right",
  fontSize = 2.25,
  spacing = 1.55,
  curve = .82,
  tilt = 7,
  blur = .7,
  fade = .14,
  minOpacity = .24,
  smoothing = 165,
  inset = 44,
  loop = false,
  draggable = true,
  className = "",
  ariaLabel = "菜单选项",
  autoFocus = false,
}: OptionWheelProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const positionRef = useRef(defaultSelected);
  const targetRef = useRef(defaultSelected);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const configRef = useRef<WheelConfig>({
    count: items.length,
    items,
    rowHeight: 1,
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    loop,
    smoothing,
    draggable,
  });
  const onChangeRef = useRef(onChange);
  const onActivateRef = useRef(onActivate);
  const onItemHoverRef = useRef(onItemHover);
  const selectedRef = useRef(normalizeIndex(defaultSelected, items.length));
  const wheelTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ y: number; start: number; id: number } | null>(null);
  const dragMovedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(selectedRef.current);
  const [isDragging, setIsDragging] = useState(false);
  const optionIdBase = useId().replace(/:/g, "");

  onChangeRef.current = onChange;
  onActivateRef.current = onActivate;
  onItemHoverRef.current = onItemHover;

  const remPx = typeof window === "undefined"
    ? 16
    : parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;

  configRef.current = {
    count: items.length,
    items,
    rowHeight: Math.max(fontSize * spacing * remPx, 1),
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    loop,
    smoothing,
    draggable,
  };

  const renderFrame = useCallback((now: number) => {
    const config = configRef.current;
    const deltaTime = Math.min((now - lastFrameRef.current) / 1000, .05);
    const timeConstant = Math.max(config.smoothing, 1) / 1000;
    const easing = reducedMotionRef.current ? 1 : 1 - Math.exp(-deltaTime / timeConstant);
    const target = targetRef.current;
    const current = positionRef.current;
    let next = current + (target - current) * easing;
    const settled = reducedMotionRef.current || Math.abs(target - next) < .001;
    if (settled) next = target;
    positionRef.current = next;
    lastFrameRef.current = now;

    const mirror = config.side === "right" ? -1 : 1;
    const tiltRadians = (config.tilt * Math.PI) / 180;
    const radius = tiltRadians > .0005 ? config.rowHeight / tiltRadians : 0;

    itemRefs.current.forEach((element, index) => {
      if (!element) return;
      let distanceFromCenter = index - next;
      if (config.loop && config.count > 1) {
        distanceFromCenter = ((distanceFromCenter % config.count) + config.count) % config.count;
        if (distanceFromCenter > config.count / 2) distanceFromCenter -= config.count;
      }

      const distance = Math.abs(distanceFromCenter);
      let x = 0;
      let y = distanceFromCenter * config.rowHeight;
      let rotation = 0;
      if (radius > 0) {
        const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, distanceFromCenter * tiltRadians));
        y = radius * Math.sin(angle);
        x = -mirror * radius * (1 - Math.cos(angle)) * config.curve;
        rotation = (mirror * angle * 180) / Math.PI;
      }

      element.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rotation.toFixed(3)}deg)`;
      element.style.opacity = String(Math.max(config.minOpacity, 1 - distance * config.fade));
      element.style.filter = config.blur > 0 ? `blur(${(distance * config.blur).toFixed(2)}px)` : "none";
      element.style.setProperty("--ow-p", Math.max(0, 1 - Math.min(distance, 1)).toFixed(4));
    });

    animationRef.current = settled ? null : window.requestAnimationFrame(renderFrame);
  }, []);

  const startAnimation = useCallback(() => {
    if (animationRef.current !== null) return;
    lastFrameRef.current = performance.now();
    animationRef.current = window.requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  const applyTarget = useCallback((value: number, snap: boolean) => {
    const config = configRef.current;
    if (!config.count) return;
    let nextValue = value;
    if (!config.loop) {
      nextValue = Math.min(Math.max(nextValue, 0), Math.max(config.count - 1, 0));
    }
    if (snap) nextValue = Math.round(nextValue);
    targetRef.current = nextValue;

    const nextIndex = normalizeIndex(nextValue, config.count);
    if (nextIndex !== selectedRef.current) {
      selectedRef.current = nextIndex;
      setSelectedIndex(nextIndex);
      onChangeRef.current?.(nextIndex, config.items[nextIndex]);
    }
    startAnimation();
  }, [startAnimation]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reducedMotionRef.current = media.matches;
    };
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (autoFocus) {
      window.requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
    }
  }, [autoFocus]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const config = configRef.current;
      const delta = event.deltaMode === 1 ? event.deltaY * 24 : event.deltaY;
      const step = Math.max(-1, Math.min(1, delta / config.rowHeight));
      applyTarget(targetRef.current + step, false);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => applyTarget(targetRef.current, true), 140);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    };
  }, [applyTarget]);

  useLayoutEffect(() => {
    const initialIndex = Math.min(Math.max(defaultSelected, 0), Math.max(items.length - 1, 0));
    positionRef.current = initialIndex;
    targetRef.current = initialIndex;
    selectedRef.current = initialIndex;
    setSelectedIndex(initialIndex);
    startAnimation();
  }, [defaultSelected, items.length, startAnimation]);

  useEffect(() => () => {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (wheelTimerRef.current !== null) {
      window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!configRef.current.draggable) return;
    dragRef.current = { y: event.clientY, start: targetRef.current, id: event.pointerId };
    dragMovedRef.current = false;
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaY = event.clientY - drag.y;
    if (!dragMovedRef.current && Math.abs(deltaY) > 4) {
      dragMovedRef.current = true;
      rootRef.current?.setPointerCapture(drag.id);
    }
    if (dragMovedRef.current) {
      applyTarget(drag.start - deltaY / configRef.current.rowHeight, false);
    }
  }

  function handlePointerEnd() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    if (dragMovedRef.current) applyTarget(targetRef.current, true);
  }

  function handleItemClick(index: number) {
    if (dragMovedRef.current) return;
    const config = configRef.current;
    const current = targetRef.current;
    let distance = index - normalizeIndex(current, config.count);
    if (config.loop && config.count > 1) {
      if (distance > config.count / 2) distance -= config.count;
      else if (distance < -config.count / 2) distance += config.count;
    }
    applyTarget(current + distance, true);
    onActivateRef.current?.(index, config.items[index]);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let delta: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") delta = -1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") delta = 1;
    else if (event.key === "Home") {
      event.preventDefault();
      applyTarget(0, true);
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      applyTarget(items.length - 1, true);
      return;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const index = selectedRef.current;
      onActivateRef.current?.(index, configRef.current.items[index]);
      return;
    }
    if (delta === null) return;
    event.preventDefault();
    applyTarget(Math.round(targetRef.current) + delta, true);
  }

  function initialItemStyle(index: number): CSSProperties {
    const distanceFromCenter = index - defaultSelected;
    const distance = Math.abs(distanceFromCenter);
    const mirror = side === "right" ? -1 : 1;
    const tiltRadians = (tilt * Math.PI) / 180;
    const rowHeight = Math.max(fontSize * spacing * remPx, 1);
    const radius = tiltRadians > .0005 ? rowHeight / tiltRadians : 0;
    let x = 0;
    let y = distanceFromCenter * rowHeight;
    let rotation = 0;
    if (radius > 0) {
      const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, distanceFromCenter * tiltRadians));
      y = radius * Math.sin(angle);
      x = -mirror * radius * (1 - Math.cos(angle)) * curve;
      rotation = (mirror * angle * 180) / Math.PI;
    }
    return {
      transform: `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rotation.toFixed(3)}deg)`,
      opacity: Math.max(minOpacity, 1 - distance * fade),
      filter: blur > 0 ? `blur(${(distance * blur).toFixed(2)}px)` : "none",
      "--ow-p": Math.max(0, 1 - Math.min(distance, 1)).toFixed(4),
    } as CSSProperties;
  }

  const rootStyle = {
    "--ow-text-color": textColor,
    "--ow-active-color": activeColor,
    "--ow-font-size": `${fontSize}rem`,
    "--ow-inset": `${inset}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-activedescendant={`${optionIdBase}-${selectedIndex}`}
      className={[
        styles.root,
        side === "right" ? styles.right : "",
        isDragging ? styles.dragging : "",
        className,
      ].filter(Boolean).join(" ")}
      style={rootStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={() => onItemHoverRef.current?.(null)}
      onKeyDown={handleKeyDown}
    >
      {items.map((label, index) => (
        <button
          id={`${optionIdBase}-${index}`}
          key={`${label}-${index}`}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          type="button"
          role="option"
          aria-selected={selectedIndex === index}
          tabIndex={-1}
          className={`${styles.item} ${selectedIndex === index ? styles.selected : ""}`}
          style={initialItemStyle(index)}
          onPointerEnter={() => onItemHoverRef.current?.(index)}
          onClick={() => handleItemClick(index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
