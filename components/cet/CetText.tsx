"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cetTextTokens } from "@/lib/cetTextTokens";
import { WordToken } from "@/components/WordToken";
import { useReaderTextAdapter } from "@/components/ReaderTextAdapter";
import type { WordContext } from "@/types/reader";
import type { CetUnderline } from "@/types/cet";

function underlineSegment(value: string, offset: number, marks: CetUnderline[]) {
  const boundaries = [0, value.length, ...marks.flatMap(mark => [mark.start - offset, mark.end - offset])]
    .filter(point => point >= 0 && point <= value.length).sort((a, b) => a - b);
  const points = [...new Set(boundaries)];
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const mark = marks.find(item => item.start <= offset + start && item.end >= offset + end);
    const part = value.slice(start, end);
    return mark ? <span key={start} className="cet-underline" data-cet-underline-id={mark.id} data-color={mark.color}>{part}</span> : <span key={start}>{part}</span>;
  });
}

export function CetText({ text, locked, contextText, contextOffset = 0, underlines = [] }: {
  text: string; locked: boolean; contextText?: string; contextOffset?: number;
  underlines?: CetUnderline[];
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
  let offset = 0;
  return <span ref={root} className="cet-text" data-reader-selection-group={id}>{near && !locked ? tokens.map(t => {
    const start = offset;
    offset += t.value.length;
    if (t.type === "text") return <span key={t.id}>{underlineSegment(t.value, start, underlines)}</span>;
    const token = <WordToken token={t} selected={Boolean(adapter?.selected.has(t.id))} />;
    const mark = underlines.find(item => item.start < offset && item.end > start);
    return mark ? <span key={t.id} className="cet-underline" data-cet-underline-id={mark.id} data-color={mark.color}>{token}</span> : <span key={t.id}>{token}</span>;
  }) : underlineSegment(text, 0, underlines)}</span>;
}
