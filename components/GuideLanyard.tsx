"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./GuideLanyard.module.css";

const Scene = dynamic(() => import("./GuideLanyardScene"), { ssr: false, loading: () => <div className={styles.loading}>吊牌正在落下…</div> });

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function GuideLanyard({ onOpen, running, motionEnabled }: { onOpen: () => void; running: boolean; motionEnabled: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reduced, setReduced] = useState(false);
  const [supported, setSupported] = useState(true);
  const [started, setStarted] = useState(false);
  const [settling, setSettling] = useState(false);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener("change", update);
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    setSupported(Boolean(gl));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (running) setStarted(true);
    if (!running && timer.current) { clearTimeout(timer.current); timer.current = null; setSettling(false); }
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [running]);
  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setSettling(false);
  }
  function release() {
    cancelPending();
    if (!running) return;
    setSettling(true);
    timer.current = setTimeout(() => { timer.current = null; setSettling(false); open.current(); }, 1000);
  }
  const fallback = <button className={styles.fallback} onClick={() => open.current()} aria-label="打开 Menu 中的使用说明"><span>使用说明</span><small>Context Reader</small></button>;
  return <div className={styles.lanyard} data-guide-lanyard data-settling={settling}>
    {supported && motionEnabled && !reduced ? <SceneBoundary fallback={fallback}>
      {started && <Scene running={running} onDragStart={cancelPending} onDragRelease={release} />}
      <button className={styles.keyboard} onClick={() => open.current()}>打开 Menu 中的使用说明</button>
    </SceneBoundary> : fallback}
    <span className={styles.status} role="status">{settling ? "即将打开使用说明…" : ""}</span>
  </div>;
}
