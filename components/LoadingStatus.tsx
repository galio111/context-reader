import type { ReactNode } from "react";

/** A small, shared pending state that preserves layout and remains legible with reduced motion. */
export function LoadingStatus({ children = "正在加载…", className = "" }: { children?: ReactNode; className?: string }) {
  return <span role="status" aria-live="polite" className={`cr-loading-status ${className}`}><span className="cr-loading-spinner" aria-hidden="true" />{children}</span>;
}
