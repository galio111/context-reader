"use client";

import { Component, Suspense, lazy, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { LoadingStatus } from "./LoadingStatus";
import { isReaderChunkError, reportReaderFailure, type ReaderSurface } from "@/lib/readerFailureReporting";
import styles from "./ReaderRecovery.module.css";

interface RecoveryActions {
  onRetry: () => void;
  onBack: () => void;
}

function ReaderRecoveryScreen({ surface, failed = false, error, onRetry, onBack }: RecoveryActions & {
  surface: ReaderSurface;
  failed?: boolean;
  error?: unknown;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [theme, setTheme] = useState<"day" | "night">("day");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("context-reader-home-ui-v1") || "null");
      if (saved?.theme === "night") setTheme("night");
    } catch { /* A blocked or stale preference cannot prevent recovery. */ }
  }, []);
  useEffect(() => {
    if (failed) heading.current?.focus({ preventScroll: true });
  }, [failed]);
  const label = surface === "cet" ? "真题" : "文章";
  return <main className={styles.stage} data-theme={theme} data-reader-recovery={failed ? "error" : "loading"}>
    {failed ? <>
      <h1 ref={heading} tabIndex={-1}>{label}暂时无法打开</h1>
      <p role="alert">{typeof navigator !== "undefined" && navigator.onLine === false
        ? "当前离线，联网后可重试。"
        : isReaderChunkError(error) ? "页面资源加载失败，请重试。" : "页面显示遇到问题，请重试或返回首页。"}</p>
    </> : <LoadingStatus>正在打开{label}…</LoadingStatus>}
    <div className={styles.actions}>
      {failed && <button type="button" className={styles.primary} onClick={onRetry}>重新打开</button>}
      <button type="button" onClick={onBack}>返回首页</button>
    </div>
  </main>;
}

class ReaderErrorBoundary extends Component<RecoveryActions & {
  surface: ReaderSurface;
  attempt: number;
  children: ReactNode;
}, { failed: boolean; error?: unknown }> {
  state: { failed: boolean; error?: unknown } = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the original exception available locally. Uploaded diagnostics contain
    // only its class and static bundle locations, never article text or props.
    console.error("Reader could not open", error);
    void reportReaderFailure(error, info.componentStack, this.props.surface, this.props.attempt).catch(() => {
      // Telemetry must not replace the original failure or break its recovery UI.
    });
  }

  render() {
    return this.state.failed
      ? <ReaderRecoveryScreen {...this.props} failed error={this.state.error} />
      : this.props.children;
  }
}

/** Keep each lazy instance stable until the user explicitly retries it.
 * React.lazy caches rejected promises; remounting the same lazy type cannot retry.
 * The surrounding HomeClient owns the article and navigation throughout recovery.
 */
export function createRecoverableReader<Props extends { onBack: () => void }>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  surface: ReaderSurface,
) {
  function RecoverableReader({ onRecoveryBack, ...props }: Props & { onRecoveryBack?: () => void }) {
    const [{ Reader, attempt }, setInstance] = useState(() => ({ Reader: lazy(load), attempt: 0 }));
    const onBack = onRecoveryBack ?? props.onBack;
    const onRetry = () => setInstance(previous => ({ Reader: lazy(load), attempt: previous.attempt + 1 }));
    return <ReaderErrorBoundary key={attempt} surface={surface} attempt={attempt} onRetry={onRetry} onBack={onBack}>
      <Suspense fallback={<ReaderRecoveryScreen surface={surface} onRetry={onRetry} onBack={onBack} />}>
        <Reader {...props as Props} />
      </Suspense>
    </ReaderErrorBoundary>;
  }
  RecoverableReader.displayName = surface === "cet" ? "RecoverableCetReader" : "RecoverableArticleReader";
  return RecoverableReader;
}
