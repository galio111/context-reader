"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { tokenizeArticle, tokenToWordContext } from "@/lib/tokenizer";
import { LATIN_PHRASE_PATTERN } from "@/lib/latinWords";
import type { WordContext } from "@/types/reader";
export function CetText({
  text,
  locked,
  lookup,
  active,
  onActive,
  contextText,
}: {
  text: string;
  locked: boolean;
  lookup: (c: WordContext) => void;
  active: string;
  onActive: (id: string) => void;
  contextText?: string;
}) {
  const id = useId(),
    root = useRef<HTMLSpanElement>(null),
    dragged = useRef(false);
  const [near, setNear] = useState(false);
  const tokens = useMemo(
    () =>
      near && !locked ? tokenizeArticle(text).flatMap((p) => p.tokens) : [],
    [text, near, locked],
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((e) => e.isIntersecting)),
      { rootMargin: "600px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const explain = (word: string, key: string, offset = 0) => {
    if (locked || !LATIN_PHRASE_PATTERN.test(word.trim())) return;
    const source = contextText || text;
    const position = Math.max(0, source.indexOf(text)) + offset;
    const token = tokenizeArticle(source)
      .flatMap((p) => p.tokens)
      .find((t) => t.type === "word" && t.start >= position);
    onActive(key);
    lookup({
      ...(token
        ? tokenToWordContext(token)
        : {
            sentence: source,
            previousSentence: "",
            nextSentence: "",
            paragraphIndex: 0,
            tokenIndex: 0,
          }),
      word: word.trim(),
    });
  };
  return (
    <span
      ref={root}
      className="cet-text"
      style={{ userSelect: locked ? "none" : "text" }}
      onPointerDown={() => {
        dragged.current = false;
      }}
      onPointerUp={() => {
        const selection = window.getSelection();
        if (
          !selection ||
          selection.isCollapsed ||
          !root.current?.contains(selection.anchorNode) ||
          !root.current?.contains(selection.focusNode)
        )
          return;
        dragged.current = true;
        const anchor =
          selection.anchorNode?.parentElement?.closest<HTMLElement>(
            "[data-cet-offset]",
          );
        explain(
          selection.toString(),
          id,
          Number(anchor?.dataset.cetOffset || 0),
        );
      }}
      onClick={(event) => {
        if (dragged.current || locked) return;
        const token = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-cet-token]",
        );
        if (token)
          explain(
            token.textContent || "",
            token.dataset.cetToken || "",
            Number(token.dataset.cetOffset || 0),
          );
      }}
    >
      {near && !locked
        ? tokens.map((token, i) =>
            token.type === "word" ? (
              <span
                key={i}
                data-cet-token={`${id}-${i}`}
                data-cet-offset={token.start}
                className={
                  active === `${id}-${i}` ? "cet-token-active" : undefined
                }
              >
                {token.value}
              </span>
            ) : (
              token.value
            ),
          )
        : text}
    </span>
  );
}
