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

interface SuspendableRender {
  drawFrame: () => void;
}

interface RenderControl {
  render: SuspendableRender;
  drawFrame: () => void;
}

interface PageFlipRuntime {
  getRender: () => SuspendableRender;
  getSettings: () => {
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
  };
  update: () => void;
}

const noFrame = () => {};

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
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
    clone.querySelectorAll<HTMLElement>("[id], [aria-labelledby], [aria-describedby], [tabindex]").forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("aria-labelledby");
      element.removeAttribute("aria-describedby");
      element.setAttribute("tabindex", "-1");
    });
    clone.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("button, input, textarea, select").forEach((element) => {
      element.setAttribute("tabindex", "-1");
    });
    clone.querySelectorAll<HTMLElement>("canvas, video, iframe").forEach((element) => element.remove());
    content.appendChild(clone);
  }

  const grain = document.createElement("span");
  grain.className = styles.paperGrain;
  viewport.append(content, grain);
  page.appendChild(viewport);
  return page;
}

function makeBlankPages() {
  return [
    makeSnapshotPage(null, "left"),
    makeSnapshotPage(null, "right"),
    makeSnapshotPage(null, "left"),
    makeSnapshotPage(null, "right"),
  ];
}

export const CurvedPageTurn = forwardRef<CurvedPageTurnHandle, CurvedPageTurnProps>(function CurvedPageTurn(
  { active, direction },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  const renderControlRef = useRef<RenderControl | null>(null);
  const destroyedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const setRendererActive = (nextActive: boolean) => {
    const control = renderControlRef.current;
    if (!control) return;
    control.render.drawFrame = nextActive ? control.drawFrame : noFrame;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    destroyedRef.current = false;
    let host: HTMLDivElement | null = null;

    void import("page-flip/dist/js/page-flip.module.js").then(({ PageFlip: PageFlipConstructor }) => {
      if (destroyedRef.current || !container.isConnected) return;
      const rect = container.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return;

      host = document.createElement("div");
      host.className = styles.engine;
      container.appendChild(host);
      const initialPages = makeBlankPages();
      const instance = new PageFlipConstructor(host, {
        width: Math.max(1, rect.width / 2),
        height: Math.max(1, rect.height),
        size: "fixed",
        drawShadow: false,
        flippingTime: 720,
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
        const state = String(event.data);
        container.dataset.flipState = state;
        if (state === "read") {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (destroyedRef.current || pageFlipRef.current !== instance) return;
              instance.updateFromHtml(makeBlankPages());
              setRendererActive(false);
            });
          });
        }
      });
      instance.loadFromHTML(initialPages);
      const render = (instance as unknown as PageFlipRuntime).getRender();
      renderControlRef.current = { render, drawFrame: render.drawFrame };
      pageFlipRef.current = instance;
      container.dataset.flipState = "read";
      setReady(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setRendererActive(false));
      });
    }).catch(() => {
      setReady(false);
    });

    return () => {
      destroyedRef.current = true;
      setRendererActive(false);
      renderControlRef.current = null;
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
      setRendererActive(true);
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const runtime = instance as unknown as PageFlipRuntime;
        const settings = runtime.getSettings();
        settings.width = settings.minWidth = settings.maxWidth = Math.max(1, rect.width / 2);
        settings.height = settings.minHeight = settings.maxHeight = Math.max(1, rect.height);
        runtime.update();
      }

      const sourceLeft = makeSnapshotPage(source, "left");
      const sourceRight = makeSnapshotPage(source, "right");
      const targetLeft = makeSnapshotPage(target, "left");
      const targetRight = makeSnapshotPage(target, "right");
      const pages = nextDirection === "forward"
        ? [sourceLeft, sourceRight, targetLeft, targetRight]
        : [targetLeft, targetRight, sourceLeft, sourceRight];

      instance.updateFromHtml(pages);
      instance.turnToPage(nextDirection === "forward" ? 0 : 2);
      if (container) container.dataset.flipState = "queued";
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
