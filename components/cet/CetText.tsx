"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cetTextTokens } from "@/lib/cetTextTokens";
import { WordToken } from "@/components/WordToken";
import { useReaderTextAdapter } from "@/components/ReaderTextAdapter";
import type { WordContext } from "@/types/reader";
export function CetText({ text, locked, contextText, contextOffset = 0 }: {
  text: string; locked: boolean; contextText?: string; contextOffset?: number;
  lookup?: (c: WordContext) => void; active?: string; onActive?: (id: string) => void;
}) {
  const id = useId(), root = useRef<HTMLSpanElement>(null);
  const adapter = useReaderTextAdapter();
  const [near, setNear] = useState(false);
  const tokens = useMemo(() => {
    if (!near || locked) return [];
    return cetTextTokens(text,id,contextText || text,contextOffset);
  }, [text, contextText, contextOffset, near, locked, id]);
  const register = adapter?.register;
  useEffect(() => register?.(id, tokens), [register, id, tokens]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(e => e.isIntersecting)), {rootMargin: "600px"});
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={root} className="cet-text" data-reader-selection-group={id}>{near && !locked ? tokens.map(t => <WordToken key={t.id} token={t} selected={Boolean(adapter?.selected.has(t.id))} />) : text}</span>;
}
