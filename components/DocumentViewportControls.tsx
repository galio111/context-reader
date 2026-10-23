"use client";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "./DocumentReader.module.css";

/** Keep controls in the visible reading column, independent of ancestor overflow. */
export function DocumentViewportControls({ root, scroller, children }: {
  root: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ left: 0, width: 0, top: 80, height: 48, pinned: false, bottom: 16, showScroll: false, max: 0, value: 0 });
  useEffect(() => {
    const host = root.current, content = scroller.current, placeholder = slot.current;
    if (!host || !content || !placeholder) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = host.getBoundingClientRect();
      const position = placeholder.getBoundingClientRect();
      const height = toolbar.current?.getBoundingClientRect().height || 48;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
      const dock = document.querySelector('nav[aria-label="阅读工具"]')?.getBoundingClientRect();
      const lowerEdge = Math.min(viewportBottom - 16, dock && dock.height > 0 ? dock.top - 8 : viewportBottom);
      const top = viewportTop + 80;
      const max = Math.max(0, content.scrollWidth - content.clientWidth);
      const next = { left: bounds.left, width: bounds.width, height,
        top: Math.min(top, bounds.bottom - height - 40),
        pinned: position.top < top && bounds.bottom > top + height + 40,
        bottom: Math.max(16, window.innerHeight - Math.min(lowerEdge, bounds.bottom)),
        showScroll: max > 1 && bounds.bottom > top + height + 40 && position.bottom < lowerEdge - 40,
        max, value: content.scrollLeft };
      setGeometry(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(host); observer.observe(content); observer.observe(placeholder);
    // PDF page sizes and Word's iframe wrapper can change after lazy rendering.
    const mutation = new MutationObserver(schedule);
    mutation.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [root, scroller]);
  const controls = <div ref={toolbar} className={`${styles.toolbar} ${geometry.pinned ? styles.pinnedToolbar : ""}`}
    data-document-toolbar style={geometry.pinned ? { left: geometry.left, width: geometry.width, top: geometry.top } : undefined}
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>{children}</div>;
  return <>
    <div ref={slot} style={geometry.pinned ? { height: geometry.height + 16 } : undefined}>
      {geometry.pinned ? createPortal(controls, document.body) : controls}
    </div>
    {geometry.showScroll && createPortal(<div className={styles.floatingScroll} style={{ left: geometry.left, width: geometry.width, bottom: geometry.bottom }}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <input type="range" aria-label="左右移动文档" min={0} max={geometry.max} step={1} value={geometry.value}
        onChange={event => { const value = Number(event.target.value); if (scroller.current) scroller.current.scrollLeft = value; setGeometry(previous => ({ ...previous, value })); }} />
    </div>, document.body)}
  </>;
}
