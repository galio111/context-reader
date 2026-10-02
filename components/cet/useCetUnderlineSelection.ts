import { useEffect, useRef } from "react";

const selector = ".cet-passages, .cet-markable-questions";
function selectionRoot(node: Node | null): HTMLElement | null {
  return (node instanceof window.Element ? node : node?.parentElement)?.closest<HTMLElement>(selector) || null;
}

/** Document listeners also handle releases in the margin and mobile selection handles. */
export function useCetUnderlineSelection() {
  const capture = useRef<(root: HTMLElement) => void>(() => {});
  useEffect(() => {
    let origin: HTMLElement | null = null;
    let dragging = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const root = origin?.isConnected ? origin : selectionRoot(selection.anchorNode) || selectionRoot(selection.focusNode);
      if (root) capture.current(root);
    };
    const down = (event: PointerEvent) => {
      if (event.target instanceof window.Element && event.target.closest(".cet-underline-menu")) return;
      clearTimeout(timer);
      origin = selectionRoot(event.target as Node);
      dragging = true;
    };
    const release = () => { dragging = false; clearTimeout(timer); timer = setTimeout(read, 0); };
    const changed = () => { if (!dragging) { clearTimeout(timer); timer = setTimeout(read, 80); } };
    const key = () => { origin = null; changed(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("keyup", key);
    document.addEventListener("selectionchange", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("keyup", key);
      document.removeEventListener("selectionchange", changed);
    };
  }, []);
  return capture;
}
