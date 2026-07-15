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

const palette = ["0,122,255", "232,91,75", "0,158,143", "130,84,218", "226,151,32"];

export function BookLetterField({ paused = false }: { paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || paused) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let pointerX = width * 0.5;
    let pointerY = height * 0.4;
    let smoothX = pointerX;
    let smoothY = pointerY;
    let lastEmit = 0;
    let frame = 0;
    const particles: Particle[] = [];
    const ripples: Ripple[] = [];
    const compactLayout = window.matchMedia("(max-width: 760px)").matches;
    const ambient = Array.from({ length: compactLayout ? 0 : 38 }, (_, index) => ({
      letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      x: Math.random(),
      y: Math.random(),
      depth: 0.22 + Math.random() * 0.9,
      size: 11 + Math.random() * 24,
      alpha: 0.055 + Math.random() * 0.115,
      phase: index * 0.71,
    }));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const isQuietTarget = (target: EventTarget | null) => (
      target instanceof Element && Boolean(target.closest("input, textarea, button, a, [role='dialog'], [data-pointer-quiet]"))
    );
    const pushParticle = (x: number, y: number, burst = false) => {
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
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (event.pointerType !== "mouse" || reduced || isQuietTarget(event.target)) return;
      const now = performance.now();
      if (now - lastEmit > 52) {
        lastEmit = now;
        pushParticle(pointerX, pointerY);
      }
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || reduced || isQuietTarget(event.target)) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      ripples.push({ x: pointerX, y: pointerY, life: 1 });
      for (let index = 0; index < 4; index += 1) pushParticle(pointerX, pointerY, true);
    };
    const render = (now: number) => {
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
        context.filter = item.depth < 0.55 ? "blur(1.8px)" : "none";
        context.fillText(item.letter, 0, 0);
        context.restore();
      });

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const item = particles[index];
        item.x += item.vx;
        item.y += item.vy;
        item.life -= 0.014;
        context.save();
        context.translate(item.x, item.y);
        context.rotate((1 - item.life) * item.spin * 30);
        context.filter = item.depth < 0.8 ? "blur(.75px)" : "none";
        context.shadowColor = `rgba(${item.color},.32)`;
        context.shadowBlur = 7;
        context.fillStyle = `rgba(${item.color},${Math.max(0, item.life) * 0.94})`;
        context.font = `600 ${19 * item.depth}px Georgia`;
        context.fillText(item.letter, 0, 0);
        context.restore();
        if (item.life <= 0) particles.splice(index, 1);
      }

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        ripple.life -= 0.025;
        context.beginPath();
        context.arc(ripple.x, ripple.y, (1 - ripple.life) * 34, 0, Math.PI * 2);
        context.strokeStyle = `rgba(40,104,173,${Math.max(0, ripple.life) * 0.32})`;
        context.lineWidth = 1.5;
        context.stroke();
        if (ripple.life <= 0) ripples.splice(index, 1);
      }
      frame = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("pointerdown", pointerDown, { passive: true });
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerdown", pointerDown);
    };
  }, [paused]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
