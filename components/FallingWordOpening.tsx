"use client";

import { useEffect, useRef } from "react";

interface FallingWordOpeningProps {
  className?: string;
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

function createSprites() {
  return COLORS.map((color) => {
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

function createTargets(width: number, height: number): Array<{ x: number; y: number }> {
  const guide = document.createElement("canvas");
  guide.width = Math.max(1, Math.round(width));
  guide.height = Math.max(1, Math.round(height));
  const context = guide.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const compact = width < 720;
  const fontSize = Math.min(compact ? width * 0.18 : width * 0.09, compact ? 74 : 132);
  context.fillStyle = "#000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${fontSize}px Arial, "PingFang SC", sans-serif`;
  if (compact) {
    context.fillText("Context", width / 2, height / 2 - fontSize * 0.58);
    context.fillText("Reader", width / 2, height / 2 + fontSize * 0.58);
  } else {
    context.fillText("Context Reader", width / 2, height / 2);
  }
  const data = context.getImageData(0, 0, guide.width, guide.height).data;
  const step = compact ? 7 : 8;
  const targets: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < guide.height; y += step) {
    for (let x = 0; x < guide.width; x += step) {
      if (data[(y * guide.width + x) * 4 + 3] > 120) targets.push({ x, y });
    }
  }
  const maxParticles = compact ? 360 : 620;
  if (targets.length <= maxParticles) return targets;
  const stride = targets.length / maxParticles;
  return Array.from({ length: maxParticles }, (_, index) => targets[Math.floor(index * stride)]);
}

export function FallingWordOpening({ className = "", onReady, onComplete }: FallingWordOpeningProps) {
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
      onCompleteRef.current();
      return;
    }
    const sprites = createSprites();
    let particles: WordParticle[] = [];
    let frame = 0;
    let start = 0;
    let lastRenderedAt = 0;
    let fastStart = 0;
    let completed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const compact = rect.width < 720;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      particles = createTargets(rect.width, rect.height).map((target, index) => ({
        x: target.x,
        y: target.y,
        startX: target.x + (seeded(index, 1) - 0.5) * rect.width * 0.42,
        startY: -70 - seeded(index, 2) * rect.height * 0.72,
        delay: seeded(index, 3) * 300,
        radius: (compact ? 3.4 : 3.8) + seeded(index, 4) * (compact ? 1.8 : 2.2),
        color: index % COLORS.length,
      }));
    };

    const finishQuickly = () => {
      if (!fastStart) fastStart = performance.now();
    };
    const draw = (time: number) => {
      if (!start) start = time;
      if (time - lastRenderedAt < FRAME_INTERVAL) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastRenderedAt = time;
      const rect = canvas.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const naturalElapsed = time - start;
      const quick = fastStart ? Math.min(1, (time - fastStart) / 220) : 0;
      let allSettled = true;
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const local = Math.max(0, Math.min(1, (naturalElapsed - particle.delay) / 820));
        const progress = Math.max(local, quick);
        if (progress < 1) allSettled = false;
        const eased = 1 - Math.pow(1 - progress, 3);
        const bounce = Math.sin(progress * Math.PI * 3.1) * (1 - progress) * 28;
        const x = particle.startX + (particle.x - particle.startX) * eased;
        const y = particle.startY + (particle.y - particle.startY) * eased - bounce;
        const diameter = particle.radius * 2;
        context.drawImage(sprites[particle.color], x - particle.radius, y - particle.radius, diameter, diameter);
      }
      if (!allSettled || naturalElapsed < 1_650) {
        frame = window.requestAnimationFrame(draw);
      } else if (!completed) {
        completed = true;
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
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
