"use client";

import { useEffect, useRef, useState } from "react";
import { startupMark } from "@/lib/startupPerformance";

interface FallingWordOpeningProps {
  className?: string;
  motionEnabled?: boolean;
  onReady?: () => void;
  onComplete: () => void;
}

interface WordParticle {
  x: number;
  y: number;
  startX: number;
  startY: number;
  delay: number;
  radius: number;
  color: number;
}

const COLORS = ["#ffffff", "#171720", "#5227ff", "#2563eb", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e"];
const FRAME_INTERVAL = 1000 / 90;

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

let cachedSprites: HTMLCanvasElement[] | undefined;
function createSprites() {
  return cachedSprites ??= COLORS.map((color) => {
    const sprite = document.createElement("canvas");
    sprite.width = 40;
    sprite.height = 40;
    const context = sprite.getContext("2d");
    if (!context) return sprite;
    const gradient = context.createRadialGradient(13, 10, 2, 20, 20, 19);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.16, color);
    gradient.addColorStop(0.75, color);
    gradient.addColorStop(1, "#0d243044");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(20, 20, 18.5, 0, Math.PI * 2);
    context.fill();
    return sprite;
  });
}

const MAX_PARTICLES = 1800;
const MAX_DPR = 1.5;
const FONT_FAMILY = 'Arial, "PingFang SC", sans-serif';
const targetCache = new Map<string, { targets: Array<{x:number;y:number}>; radius:number }>();
function createTargets(width: number, height: number) {
  const key = `${Math.round(width)}:${Math.round(height)}`;
  const cached = targetCache.get(key); if (cached) return cached;
  const guide = document.createElement("canvas");
  const context = guide.getContext("2d", { willReadFrequently: true });
  if (!context) return { targets: [], radius: 2 };
  const margin = Math.max(24, Math.min(64, width * .08));
  let fontSize = Math.min(132, Math.max(68, width * .085), height * .22);
  context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  let lines = ["Context Reader"];
  if (context.measureText(lines[0]).width > width - margin * 2) lines = ["Context", "Reader"];
  while (Math.max(...lines.map(line => context.measureText(line).width)) > width - margin * 2 && fontSize > 24) {
    fontSize -= 1; context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  }
  const padding = 8, lineHeight = fontSize * 1.45;
  const metrics = lines.map(line => context.measureText(line));
  const ascent = Math.max(...metrics.map(m => m.actualBoundingBoxAscent || fontSize * .8));
  const descent = Math.max(...metrics.map(m => m.actualBoundingBoxDescent || fontSize * .2));
  guide.width = Math.ceil(Math.max(...metrics.map(m => m.width)) + padding * 2);
  guide.height = Math.ceil(ascent + descent + (lines.length - 1) * lineHeight + padding * 2);
  context.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  context.fillStyle = "#000"; context.textAlign = "center"; context.textBaseline = "alphabetic";
  lines.forEach((line, index) => context.fillText(line, guide.width / 2, padding + ascent + index * lineHeight));
  const data = context.getImageData(0, 0, guide.width, guide.height).data;
  let step = Math.max(2, fontSize / 22);
  const scan = () => {
    const points: Array<{x:number;y:number}> = [];
    for (let y = step / 2; y < guide.height; y += step) for (let x = step / 2; x < guide.width; x += step) {
      if (data[(Math.floor(y) * guide.width + Math.floor(x)) * 4 + 3] > 120) points.push({x:x+(width-guide.width)/2,y:y+(height-guide.height)/2});
    }
    return points;
  };
  let targets = scan();
  while (targets.length > MAX_PARTICLES) { step *= 1.08; targets = scan(); }
  const result = { targets, radius: step * .46 };
  if (targetCache.size >= 8) targetCache.delete(targetCache.keys().next().value!);
  targetCache.set(key, result); return result;
}

export function FallingWordOpening({ className = "", motionEnabled = true, onReady, onComplete }: FallingWordOpeningProps) {
  const [fallback, setFallback] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onReadyRef = useRef(onReady);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) {
      setFallback(true); onReadyRef.current?.();
      const timer = setTimeout(() => onCompleteRef.current(), 360);
      return () => clearTimeout(timer);
    }
    startupMark("sprites-start");
    const sprites = createSprites();
    startupMark("sprites-end");
    const reduced = !motionEnabled || matchMedia("(prefers-reduced-motion: reduce)").matches;
    let size = { width: 0, height: 0 };
    let particles: WordParticle[] = [];
    let frame = 0;
    let start = 0;
    let lastRenderedAt = 0;
    let fastStart = 0;
    let completed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(size.width - rect.width) < .5 && Math.abs(size.height - rect.height) < .5) return;
      size = { width: rect.width, height: rect.height };
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      startupMark("targets-start");
      const layout = createTargets(rect.width, rect.height);
      particles = layout.targets.map((target, index) => ({
        x: target.x,
        y: target.y,
        startX: target.x + (seeded(index, 1) - 0.5) * rect.width * 0.42,
        startY: -70 - seeded(index, 2) * rect.height * 0.72,
        delay: seeded(index, 3) * 300,
        radius: layout.radius * (.9 + seeded(index, 4) * .1),
        color: index % COLORS.length,
      }));
      startupMark("targets-end");
    };

    const finishQuickly = () => {
      if (!fastStart) fastStart = performance.now();
    };
    const draw = (time: number) => {
      if (!start) { start = time; startupMark("canvas-first-frame"); }
      if (time - lastRenderedAt < FRAME_INTERVAL) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastRenderedAt = time;
      context.clearRect(0, 0, size.width, size.height);
      const naturalElapsed = time - start;
      const quick = fastStart ? Math.min(1, (time - fastStart) / 220) : 0;
      let allSettled = true;
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const local = Math.max(0, Math.min(1, (naturalElapsed - particle.delay) / 820));
        const progress = reduced ? 1 : Math.max(local, quick);
        if (progress < 1) allSettled = false;
        const eased = 1 - Math.pow(1 - progress, 3);
        const bounce = Math.sin(progress * Math.PI * 3.1) * (1 - progress) * 28;
        const x = particle.startX + (particle.x - particle.startX) * eased;
        const y = particle.startY + (particle.y - particle.startY) * eased - bounce;
        const diameter = particle.radius * 2;
        context.drawImage(sprites[particle.color], x - particle.radius, y - particle.radius, diameter, diameter);
      }
      if (!allSettled || naturalElapsed < (reduced ? 360 : 1_650)) {
        frame = window.requestAnimationFrame(draw);
      } else if (!completed) {
        completed = true;
        startupMark("wordmark-complete");
        onCompleteRef.current();
      }
    };

    resize();
    onReadyRef.current?.();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointerdown", finishQuickly, { passive: true });
    window.addEventListener("wheel", finishQuickly, { passive: true });
    window.addEventListener("keydown", finishQuickly);
    frame = window.requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", finishQuickly);
      window.removeEventListener("wheel", finishQuickly);
      window.removeEventListener("keydown", finishQuickly);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [motionEnabled]);

  return fallback ? <div className={className} style={{ display: "grid", placeItems: "center", font: "700 clamp(28px, 7vw, 96px) Arial", color: "#17475b" }}>Context Reader</div> : <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
