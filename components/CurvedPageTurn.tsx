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
  seek: (
    key: string,
    direction: "forward" | "backward",
    source: HTMLElement | null,
    target: HTMLElement | null,
    progress: number,
  ) => void;
  clear: () => void;
}

interface CurvedPageTurnProps {
  active: boolean;
  direction: "forward" | "backward";
}

interface SuspendableRender {
  drawFrame: () => void;
}

interface SeekableRender extends SuspendableRender {
  finishAnimation: () => void;
  setBottomPage: (page: null) => void;
  setFlippingPage: (page: null) => void;
  clearShadow: () => void;
  getRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
    pageWidth: number;
  };
}

interface SeekableFlipControl {
  reset: () => void;
  start: (position: { x: number; y: number }) => boolean;
  fold: (position: { x: number; y: number }) => void;
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
  getFlipController: () => SeekableFlipControl;
  updateState: (state: string) => void;
}

const noFrame = () => {};
const SEEK_ENDPOINT_EPSILON = .00001;

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

function copyLiveScrollState(source: HTMLElement, clone: HTMLElement) {
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  sourceElements.forEach((element, index) => {
    const clonedElement = cloneElements[index];
    if (!clonedElement) return;
    if (element.scrollTop > 0) {
      clonedElement.dataset.snapshotScrollTop = String(element.scrollTop);
    }
    if (element.scrollLeft > 0) {
      clonedElement.dataset.snapshotScrollLeft = String(element.scrollLeft);
    }
  });
}

function restoreSnapshotScrollState(pages: HTMLElement[]) {
  pages.forEach((page) => {
    page.querySelectorAll<HTMLElement>("[data-snapshot-scroll-top], [data-snapshot-scroll-left]").forEach((element) => {
      const scrollTop = Number(element.dataset.snapshotScrollTop);
      const scrollLeft = Number(element.dataset.snapshotScrollLeft);
      if (Number.isFinite(scrollTop) && scrollTop > 0) element.scrollTop = scrollTop;
      if (Number.isFinite(scrollLeft) && scrollLeft > 0) element.scrollLeft = scrollLeft;
    });
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
    copyLiveScrollState(spread, clone);
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
  const seekKeyRef = useRef<string | null>(null);
  const seekTouchActiveRef = useRef(false);
  const seekSizeRef = useRef("");
  const destroyedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const setRendererActive = (nextActive: boolean) => {
    const control = renderControlRef.current;
    if (!control) return;
    control.render.drawFrame = nextActive ? control.drawFrame : noFrame;
  };

  const resetSeek = (blank = true) => {
    const instance = pageFlipRef.current;
    const container = containerRef.current;
    const hadSeek = seekKeyRef.current !== null || container?.dataset.seeking === "true";
    seekKeyRef.current = null;
    seekTouchActiveRef.current = false;
    seekSizeRef.current = "";
    if (container) {
      container.dataset.seeking = "false";
      container.style.setProperty("--turn-progress", "0");
    }
    if (!instance || !hadSeek) {
      setRendererActive(false);
      return;
    }
    try {
      const runtime = instance as unknown as PageFlipRuntime;
      const render = runtime.getRender() as SeekableRender;
      render.finishAnimation();
      render.setBottomPage(null);
      render.setFlippingPage(null);
      render.clearShadow();
      runtime.getFlipController().reset();
      runtime.updateState("read");
      if (blank) instance.updateFromHtml(makeBlankPages());
    } catch {
      // A stale page-flip frame should never block the real DOM spread.
    }
    setRendererActive(false);
  };

  const syncEngineSize = (instance: PageFlip) => {
    const container = containerRef.current;
    if (!container) return null;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const runtime = instance as unknown as PageFlipRuntime;
    const settings = runtime.getSettings();
    settings.width = settings.minWidth = settings.maxWidth = Math.max(1, width / 2);
    settings.height = settings.minHeight = settings.maxHeight = Math.max(1, height);
    runtime.update();
    return (runtime.getRender() as SeekableRender).getRect();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    destroyedRef.current = false;
    let host: HTMLDivElement | null = null;

    void import("page-flip/dist/js/page-flip.module.js").then(({ PageFlip: PageFlipConstructor }) => {
      if (destroyedRef.current || !container.isConnected) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < 40 || height < 40) return;

      host = document.createElement("div");
      host.className = styles.engine;
      container.appendChild(host);
      const initialPages = makeBlankPages();
      const instance = new PageFlipConstructor(host, {
        width: Math.max(1, width / 2),
        height: Math.max(1, height),
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
              if (
                destroyedRef.current ||
                pageFlipRef.current !== instance ||
                seekKeyRef.current !== null
              ) return;
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
      container.dataset.seeking = "false";
      setReady(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setRendererActive(false);
          window.dispatchEvent(new Event("scroll"));
        });
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
      seekKeyRef.current = null;
      seekTouchActiveRef.current = false;
      seekSizeRef.current = "";
      if (instance) {
        try { instance.destroy(); } catch { /* The host may already be detached during route changes. */ }
      } else {
        host?.remove();
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    seek(key, nextDirection, source, target, progress) {
      const container = containerRef.current;
      if (!container) return;

      const normalized = Math.min(1, Math.max(0, progress));
      const betweenEndpoints = normalized > SEEK_ENDPOINT_EPSILON && normalized < 1 - SEEK_ENDPOINT_EPSILON;
      container.style.setProperty("--turn-progress", normalized.toFixed(5));
      container.dataset.seeking = betweenEndpoints ? "true" : "false";

      if (window.matchMedia("(max-width: 760px), (prefers-reduced-motion: reduce)").matches) {
        seekKeyRef.current = betweenEndpoints ? key : null;
        return;
      }

      const instance = pageFlipRef.current;
      if (!instance) return;
      if (!betweenEndpoints) {
        if (seekKeyRef.current !== null) resetSeek();
        return;
      }

      const sizeKey = `${container.clientWidth}x${container.clientHeight}`;
      const needsSetup =
        seekKeyRef.current !== key ||
        !seekTouchActiveRef.current ||
        seekSizeRef.current !== sizeKey;
      let rect: ReturnType<SeekableRender["getRect"]>;

      if (needsSetup) {
        resetSeek(false);
        setRendererActive(true);
        const syncedRect = syncEngineSize(instance);
        if (!syncedRect) return;
        rect = syncedRect;
        const sourceLeft = makeSnapshotPage(source, "left");
        const sourceRight = makeSnapshotPage(source, "right");
        const targetLeft = makeSnapshotPage(target, "left");
        const targetRight = makeSnapshotPage(target, "right");
        const pages = nextDirection === "forward"
          ? [sourceLeft, sourceRight, targetLeft, targetRight]
          : [targetLeft, targetRight, sourceLeft, sourceRight];

        instance.updateFromHtml(pages);
        const runtime = instance as unknown as PageFlipRuntime;
        runtime.update();
        restoreSnapshotScrollState(pages);
        instance.turnToPage(nextDirection === "forward" ? 0 : 2);
        const start = nextDirection === "forward"
          ? { x: rect.left + rect.width - 2, y: rect.top + rect.height - 3 }
          : { x: rect.left + 2, y: rect.top + rect.height - 3 };
        const started = runtime.getFlipController().start(start);
        seekKeyRef.current = key;
        seekTouchActiveRef.current = started;
        seekSizeRef.current = sizeKey;
        container.style.setProperty("--turn-progress", normalized.toFixed(5));
        container.dataset.seeking = "true";
      } else {
        setRendererActive(true);
        rect = ((instance as unknown as PageFlipRuntime).getRender() as SeekableRender).getRect();
      }

      const easedLift = Math.sin(normalized * Math.PI) * rect.height * .075;
      const position = nextDirection === "forward"
        ? {
            x: rect.left + rect.width * (1 - normalized),
            y: rect.top + rect.height - 3 - easedLift,
          }
        : {
            x: rect.left + rect.width * normalized,
            y: rect.top + rect.height - 3 - easedLift,
      };
      const runtime = instance as unknown as PageFlipRuntime;
      restoreSnapshotScrollState([container]);
      runtime.getFlipController().fold(position);
      (runtime.getRender() as SeekableRender).drawFrame();
    },
    clear() {
      resetSeek();
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
