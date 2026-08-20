"use client";

import { useEffect, useRef } from "react";
import styles from "./BookLetterField.module.css";

interface Particle {
  letter: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  depth: number;
  spin: number;
  color: string;
}

interface Ripple {
  x: number;
  y: number;
  life: number;
}

interface MaskRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const palette = ["0,122,255", "232,91,75", "0,158,143", "130,84,218", "226,151,32"];
const MAX_CANVAS_PIXELS = 2_100_000;
const MAX_PARTICLES = 30;

export function BookLetterField({ paused = false }: { paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !context) return;
    if (paused) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let pointerX = width * 0.5;
    let pointerY = height * 0.4;
    let smoothX = pointerX;
    let smoothY = pointerY;
    let lastEmit = 0;
    let lastPaint = 0;
    let lastPointerAt = 0;
    let frame = 0;
    let maskFrame = 0;
    const debugPerformance = new URLSearchParams(window.location.search).has("perf");
    let performanceSampleStart = 0;
    let performanceLastFrame = 0;
    let performanceFrameCount = 0;
    let performancePaintCount = 0;
    let performanceWorkTotal = 0;
    let performanceWorstGap = 0;
    const particles: Particle[] = [];
    const ripples: Ripple[] = [];
    let maskRects: MaskRect[] = [];
    const compactLayout = window.matchMedia("(max-width: 760px)").matches;
    const ambient = Array.from({ length: compactLayout ? 0 : 22 }, (_, index) => ({
      letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      x: Math.random(),
      y: Math.random(),
      depth: 0.22 + Math.random() * 0.9,
      size: 11 + Math.random() * 22,
      alpha: 0.05 + Math.random() * 0.1,
      phase: index * 0.71,
    }));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const pixelBudgetRatio = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
      dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.25, pixelBudgetRatio));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!compactLayout) scheduleMaskRefresh();
    };
    const isMaskedTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest("[data-pointer-mask]"));
    };
    const refreshMaskRects = () => {
      maskFrame = 0;
      if (compactLayout) {
        maskRects = [];
        return;
      }
      if (!document.querySelector("[data-book-cover-state='open']")) {
        maskRects = [];
        return;
      }
      maskRects = Array.from(document.querySelectorAll<HTMLElement>("[data-pointer-mask]"))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height)
        .map((rect) => ({
          left: rect.left - 8,
          top: rect.top - 8,
          width: rect.width + 16,
          height: rect.height + 16,
        }));
    };
    const scheduleMaskRefresh = () => {
      if (maskFrame) return;
      maskFrame = window.requestAnimationFrame(refreshMaskRects);
    };
    const clearMaskedZones = () => {
      if (maskRects.length === 0) return;
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = "#000";
      maskRects.forEach((rect) => {
        context.fillRect(rect.left, rect.top, rect.width, rect.height);
      });
      context.restore();
    };
    const pushParticle = (x: number, y: number, burst = false) => {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push({
        letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)),
        x,
        y,
        vx: (Math.random() - 0.5) * (burst ? 2.6 : 1.35),
        vy: (burst ? -0.2 : -0.55) - Math.random() * (burst ? 1.8 : 0.9),
        life: 1,
        depth: 0.68 + Math.random() * 1.25,
        spin: (Math.random() - 0.5) * 0.045,
        color: palette[Math.floor(Math.random() * palette.length)],
      });
    };
    const pointerMove = (event: PointerEvent) => {
      if (compactLayout) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      lastPointerAt = performance.now();
      if (frame === 0) frame = requestAnimationFrame(render);
      if (event.pointerType !== "mouse" || reduced || isMaskedTarget(event.target)) return;
      const now = performance.now();
      if (now - lastEmit > 52) {
        lastEmit = now;
        pushParticle(pointerX, pointerY);
      }
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || reduced || isMaskedTarget(event.target)) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      ripples.push({ x: pointerX, y: pointerY, life: 1 });
      if (frame === 0) frame = requestAnimationFrame(render);
    };
    const render = (now: number) => {
      const workStartedAt = performance.now();
      if (debugPerformance) {
        if (!performanceSampleStart) {
          performanceSampleStart = workStartedAt;
          performanceLastFrame = workStartedAt;
        }
        performanceFrameCount += 1;
        performanceWorstGap = Math.max(performanceWorstGap, workStartedAt - performanceLastFrame);
        performanceLastFrame = workStartedAt;
      }
      const activeMotion = particles.length > 0 || ripples.length > 0 || now - lastPointerAt < 450;
      const minFrameTime = activeMotion ? 1000 / 60 : 1000 / 30;
      if (now - lastPaint < minFrameTime) {
        if (debugPerformance) performanceWorkTotal += performance.now() - workStartedAt;
        frame = requestAnimationFrame(render);
        return;
      }
      const elapsedScale = Math.min(2, Math.max(.5, (now - lastPaint) / (1000 / 60)));
      lastPaint = now;
      smoothX += (pointerX - smoothX) * 0.075;
      smoothY += (pointerY - smoothY) * 0.075;
      context.clearRect(0, 0, width, height);
      const px = smoothX / width - 0.5;
      const py = smoothY / height - 0.5;

      ambient.forEach((item) => {
        context.save();
        context.translate(item.x * width + px * 48 * item.depth, item.y * height + py * 34 * item.depth);
        context.rotate(Math.sin(now * 0.00025 + item.phase) * 0.08);
        context.fillStyle = `rgba(40,104,173,${item.alpha})`;
        context.font = `${Math.round(item.size * item.depth)}px Georgia`;
        context.fillText(item.letter, 0, 0);
        context.restore();
      });

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const item = particles[index];
        item.x += item.vx * elapsedScale;
        item.y += item.vy * elapsedScale;
        item.life -= 0.014 * elapsedScale;
        context.save();
        context.translate(item.x, item.y);
        context.rotate((1 - item.life) * item.spin * 30);
        context.shadowColor = `rgba(${item.color},.2)`;
        context.shadowBlur = 2;
        context.fillStyle = `rgba(${item.color},${Math.max(0, item.life) * 0.94})`;
        context.font = `600 ${19 * item.depth}px Georgia`;
        context.fillText(item.letter, 0, 0);
        context.restore();
        if (item.life <= 0) particles.splice(index, 1);
      }

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        ripple.life -= 0.025 * elapsedScale;
        context.beginPath();
        context.arc(ripple.x, ripple.y, (1 - ripple.life) * 34, 0, Math.PI * 2);
        context.strokeStyle = `rgba(40,104,173,${Math.max(0, ripple.life) * 0.32})`;
        context.lineWidth = 1.5;
        context.stroke();
        if (ripple.life <= 0) ripples.splice(index, 1);
      }
      clearMaskedZones();
      if (debugPerformance) {
        performancePaintCount += 1;
        performanceWorkTotal += performance.now() - workStartedAt;
        if (workStartedAt - performanceSampleStart >= 3_000) {
          const duration = workStartedAt - performanceSampleStart;
          console.info(
            `[LetterField perf] callbacks=${(performanceFrameCount * 1000 / duration).toFixed(1)} `
            + `paints=${(performancePaintCount * 1000 / duration).toFixed(1)} `
            + `work=${(performanceWorkTotal / performanceFrameCount).toFixed(2)}ms `
            + `worstGap=${performanceWorstGap.toFixed(1)}ms`,
          );
          performanceSampleStart = workStartedAt;
          performanceFrameCount = 0;
          performancePaintCount = 0;
          performanceWorkTotal = 0;
          performanceWorstGap = 0;
        }
      }
      const pointerSettling = Math.abs(pointerX - smoothX) + Math.abs(pointerY - smoothY) > 0.6;
      const needsAnotherFrame = particles.length > 0
        || ripples.length > 0
        || now - lastPointerAt < 520
        || pointerSettling;
      if (!needsAnotherFrame) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(render);
    };

    resize();
    if (!compactLayout) refreshMaskRects();
    window.addEventListener("resize", resize);
    if (!compactLayout) {
      window.addEventListener("scroll", scheduleMaskRefresh, { passive: true });
      window.addEventListener("context-reader:book-layout-change", scheduleMaskRefresh);
    }
    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("pointerdown", pointerDown, { passive: true });
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(maskFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scheduleMaskRefresh);
      window.removeEventListener("context-reader:book-layout-change", scheduleMaskRefresh);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerdown", pointerDown);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
    };
  }, [paused]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
