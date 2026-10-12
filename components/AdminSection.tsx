"use client";
import { useState, type ReactNode } from "react";

/** Load on first visit, then preserve the page, filters and drafts on return. */
export function AdminSection({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <div hidden={!active}>{(active || visited) && children}</div>;
}
