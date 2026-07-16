"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PageFlip } from "page-flip/dist/js/page-flip.module.js";
import styles from "./CurvedPageTurn.module.css";

export interface CurvedPageTurnHandle {
  flip: (direction: "forward" | "backward", source: HTMLElement | null, target: HTMLElement | null) => void;
}

interface CurvedPageTurnProps {
  active: boolean;
  direction: "forward" | "backward";
}

function copyLiveFormState(source: HTMLElement, clone: HTMLElement) {
  const sourceControls = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  const cloneControls = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  sourceControls.forEach((control, index) => {
    const clonedControl = cloneControls[index];
    if (!clonedControl) return;
    clonedControl.value = control.value;
    if (control instanceof HTMLInputElement && clonedControl instanceof HTMLInputElement) {
      clonedControl.checked = control.checked;
    }
  });
}

function makeSnapshotPage(spread: HTMLElement | null, side: "left" | "right") {
  const page = document.createElement("div");
  page.className = styles.turnPaper;
  page.dataset.density = "soft";

  const viewport = document.createElement("div");
  viewport.className = `${styles.snapshotViewport} ${side === "right" ? styles.snapshotRight : ""}`;
  const content = document.createElement("div");
  content.className = styles.snapshotContent;

  if (spread) {
    const clone = spread.cloneNode(true) as HTMLElement;
    copyLiveFormState(spread, clone);
    clone.removeAttribute("aria-hidden");
    clone.removeAttribute("inert");
    clone.querySelectorAll<HTMLElement>("[id], [aria-labelledby], [aria-describedby], [tabindex]").forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("aria-labelledby");
      element.removeAttribute("aria-describedby");
      element.setAttribute("tabindex", "-1");
    });
    clone.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("button, input, textarea, select").forEach((element) => {
      element.disabled = true;
      element.setAttribute("tabindex", "-1");
    });
    content.appendChild(clone);
  }

  const grain = document.createElement("span");
  grain.className = styles.paperGrain;
  viewport.append(content, grain);
  page.appendChild(viewport);
  return page;
}

export const CurvedPageTurn = forwardRef<CurvedPageTurnHandle, CurvedPageTurnProps>(function CurvedPageTurn(
  { active, direction },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  const destroyedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    destroyedRef.current = false;
    let host: HTMLDivElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer = 0;
    let lastWidth = 0;
    let lastHeight = 0;

    void import("page-flip/dist/js/page-flip.module.js").then(({ PageFlip: PageFlipConstructor }) => {
      const rebuild = () => {
        if (destroyedRef.current || !container.isConnected) return;
        const rect = container.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return;

        const previous = pageFlipRef.current;
        pageFlipRef.current = null;
        if (previous) {
          try { previous.destroy(); } catch { host?.remove(); }
        } else {
          host?.remove();
        }

        host = document.createElement("div");
        host.className = styles.engine;
        container.appendChild(host);
        const initialPages = [
          makeSnapshotPage(null, "left"),
          makeSnapshotPage(null, "right"),
          makeSnapshotPage(null, "left"),
          makeSnapshotPage(null, "right"),
        ];
        const instance = new PageFlipConstructor(host, {
          width: Math.max(1, rect.width / 2),
          height: Math.max(1, rect.height),
          size: "fixed",
          drawShadow: false,
          flippingTime: 1080,
          usePortrait: false,
          autoSize: false,
          maxShadowOpacity: .18,
          showCover: false,
          mobileScrollSupport: true,
          clickEventForward: false,
          useMouseEvents: false,
          showPageCorners: false,
          disableFlipByClick: true,
          startPage: 0,
        });
        instance.on("changeState", (event) => {
          container.dataset.flipState = String(event.data);
        });
        instance.loadFromHTML(initialPages);
        pageFlipRef.current = instance;
        lastWidth = rect.width;
        lastHeight = rect.height;
        container.dataset.flipState = "read";
        setReady(true);
      };

      rebuild();
      resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (Math.abs(width - lastWidth) < 2 && Math.abs(height - lastHeight) < 2) return;
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(rebuild, 120);
      });
      resizeObserver.observe(container);
    }).catch(() => {
      setReady(false);
    });

    return () => {
      destroyedRef.current = true;
      resizeObserver?.disconnect();
      window.clearTimeout(resizeTimer);
      const instance = pageFlipRef.current;
      pageFlipRef.current = null;
      if (instance) {
        try { instance.destroy(); } catch { /* The host may already be detached during route changes. */ }
      } else {
        host?.remove();
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    flip(nextDirection, source, target) {
      const instance = pageFlipRef.current;
      if (!instance || window.matchMedia("(max-width: 760px), (prefers-reduced-motion: reduce)").matches) return;

      const sourceLeft = makeSnapshotPage(source, "left");
      const sourceRight = makeSnapshotPage(source, "right");
      const targetLeft = makeSnapshotPage(target, "left");
      const targetRight = makeSnapshotPage(target, "right");
      const pages = nextDirection === "forward"
        ? [sourceLeft, sourceRight, targetLeft, targetRight]
        : [targetLeft, targetRight, sourceLeft, sourceRight];

      instance.updateFromHtml(pages);
      instance.turnToPage(nextDirection === "forward" ? 0 : 2);
      if (containerRef.current) containerRef.current.dataset.flipState = "queued";
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => instance.flip(nextDirection === "forward" ? 2 : 0, "bottom"));
      });
    },
  }), []);

  return (
    <div
      ref={containerRef}
      className={`${styles.turnLayer} ${active ? styles.active : ""} ${ready ? styles.ready : ""} ${direction === "backward" ? styles.backward : ""}`}
      data-flip-direction={direction}
      aria-hidden="true"
    >
      <span className={styles.fallbackLeaf} />
    </div>
  );
});
