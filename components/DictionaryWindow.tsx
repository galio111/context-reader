"use client";
import { useEffect, useRef, type ReactNode, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./ReaderToolbar.module.css";

/** One dictionary window for Reader and study; a native top layer keeps study's dialog usable. */
export function DictionaryWindow({ children, closing = false, modal = false, onClose, zIndex, onBringToFront }: {
  children: ReactNode; closing?: boolean; modal?: boolean; onClose: () => void;
  zIndex?: number; onBringToFront?: () => void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  function persist() {
    const element = windowRef.current;
    if (!element) return;
    const { left, top, width, height } = element.getBoundingClientRect();
    try { localStorage.setItem("context-reader-dictionary-window-v1", JSON.stringify({ left, top, width, height })); } catch {}
  }
  useEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    if (element instanceof HTMLDialogElement) element.showModal();
    try {
      const saved = JSON.parse(localStorage.getItem("context-reader-dictionary-window-v1") || "null");
      const width = Math.min(Math.max(saved?.width ?? 340, 300), window.innerWidth - 28);
      const height = Math.min(Math.max(saved?.height ?? 560, 380), window.innerHeight - 28);
      const grip = Math.min(104, width);
      const left = Math.min(Math.max(saved?.left ?? 132, grip - width), window.innerWidth - grip);
      const top = Math.min(Math.max(saved?.top ?? 92, 14), window.innerHeight - 58);
      Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    } catch {}
    return () => {
      dragCleanup.current?.();
      if (element instanceof HTMLDialogElement) element.close();
    };
  }, []);
  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const element = windowRef.current;
    if (!element) return;
    event.preventDefault();
    dragCleanup.current?.();
    const rect = element.getBoundingClientRect();
    const { clientX, clientY } = event;
    const move = (next: globalThis.PointerEvent) => {
      const grip = Math.min(104, rect.width);
      element.style.left = `${Math.min(Math.max(rect.left + next.clientX - clientX, grip - rect.width), window.innerWidth - grip)}px`;
      element.style.top = `${Math.min(Math.max(rect.top + next.clientY - clientY, 12), window.innerHeight - 58)}px`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragCleanup.current = null;
      persist();
    };
    dragCleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }
  const contents = <>
    <header onPointerDown={startDrag}>
      <span><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.2" cy="8.2" r="4.7"/><path d="m11.7 11.7 4 4M6.5 8.2h3.4M8.2 6.5v3.4"/></svg>单独查词</span>
      <button type="button" aria-label="隐藏单独查词窗口" onClick={onClose}>×</button>
    </header>
    <div className={styles.dictionaryWindowBody} data-local-scroll-surface>{children}</div>
  </>;
  const shared = {
    "data-dictionary-window": true,
    className: `${styles.dictionaryWindow} ${closing ? styles.dictionaryWindowClosing : ""}`,
    "aria-label": "单独查词窗口",
    style: { zIndex }, onPointerDownCapture: onBringToFront, onPointerUp: persist,
  };
  if (modal) return createPortal(<dialog {...shared} ref={element => { windowRef.current = element; }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>{contents}</dialog>, document.body);
  return <aside {...shared} ref={element => { windowRef.current = element; }}>{contents}</aside>;
}
