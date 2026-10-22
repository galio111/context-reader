"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportedArticle } from "@/types/article";
import type { ArticleTranslationBlock, WordContext } from "@/types/reader";
import { getCachedArticleTranslationForBlocks, setCachedArticleTranslationForBlocks } from "@/lib/cache";
import { createArticleTranslationBlockCacheKey } from "@/lib/articleTranslationIdentity";
import { normalizeDocumentSelection } from "@/lib/documentSelection";

export function selectionTranslationBlocks(text: string, article: ImportedArticle): ArticleTranslationBlock[] {
  const normalized = normalizeDocumentSelection(text);
  const exact = article.blocks.find(b => normalizeDocumentSelection(b.text ?? "") === normalized);
  if (exact) return [{ id: exact.id, type: exact.type as ArticleTranslationBlock["type"], text: exact.text! }];
  // Bound each request without silently dropping the end of a large selection.
  const chunks = text.match(/[\s\S]{1,4000}(?:\s|$)|[\s\S]{1,4000}/g) ?? [text];
  return chunks.map(text => ({ id: `selection-${createArticleTranslationBlockCacheKey({ id: article.document!.id, type: "paragraph", text })}`, type: "paragraph", text }));
}

export function useDocumentSelectionTranslation(context: WordContext | null, article: ImportedArticle | null | undefined,
  owner: string | undefined, offline: boolean) {
  const key = `${owner ?? ""}:${article?.document?.id ?? ""}:${context?.word ?? ""}`;
  const [state, setState] = useState({ key: "", text: "", loading: false, notice: "" });
  const [retry, setRetry] = useState(0);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  useEffect(() => {
    if (!context || !article?.document || !owner) return;
    const controller = new AbortController();
    const blocks = selectionTranslationBlocks(context.word, article);
    const cached = new Map(getCachedArticleTranslationForBlocks(blocks).map(item => [item.id, item.translation]));
    const display = () => blocks.map(b => cached.get(b.id) ?? "").filter(Boolean).join("\n\n");
    const pending = blocks.filter(b => !cached.has(b.id));
    setState({ key, text: display(), loading: pending.length > 0 && !offline, notice: pending.length && offline ? "联网后可翻译这段内容。" : "" });
    if (!pending.length || offline) return () => controller.abort();
    void (async () => {
      const neighbours = [context.previousSentence, context.sentence, context.nextSentence].filter(Boolean)
        .map((text, i) => ({ id: `selection-context-${i}`, type: "paragraph", text: text.slice(0, 6000) }));
      for (const block of pending) {
        if (cached.has(block.id)) continue;
        const response = await fetch("/api/translate-article", { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "x-context-action-id": crypto.randomUUID() },
          body: JSON.stringify({ blocks: [block], contextBlocks: neighbours }) });
        if (controller.signal.aborted || currentOwner.current !== owner) return;
        if (!response.ok || !response.body) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(response.status === 401 || response.status === 403 ? "请登录后翻译所选内容。"
            : failure.code === "quota_exhausted" ? "当前翻译额度已用完，可在账号与用量中查看。" : "暂时未能取得译文，稍后可以重试。");
        }
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "", completed = false;
        const consume = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line);
          if (event.type === "translation" && event.translation?.id === block.id && event.translation.translation?.trim()) {
            if (controller.signal.aborted || currentOwner.current !== owner) return;
            cached.set(block.id, event.translation.translation); completed = true;
            setCachedArticleTranslationForBlocks([block], [event.translation]);
            setState({ key, text: display(), loading: true, notice: "" });
          }
        };
        try {
          while (true) {
            const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
            lines.forEach(consume); if (done) { consume(buffer); break; }
          }
        } finally { reader.releaseLock(); }
        if (!completed) throw new Error("暂时未能取得译文，稍后可以重试。");
      }
      if (!controller.signal.aborted) setState({ key, text: display(), loading: false, notice: "" });
    })().catch(error => {
      if (!controller.signal.aborted) setState({ key, text: display(), loading: false,
        notice: error instanceof Error && /^(请登录|当前翻译额度|暂时未能)/.test(error.message) ? error.message : "连接暂时中断，稍后可以重试。" });
    });
    return () => controller.abort();
  }, [context, article, owner, offline, retry, key]);
  return { ...(state.key === key ? state : { text: "", loading: Boolean(context) && !offline, notice: "" }), retry: () => setRetry(value => value + 1) };
}

export function DocumentSelectionTranslation({ context, result }: { context: WordContext; result: ReturnType<typeof useDocumentSelectionTranslation> }) {
  const [showSource, setShowSource] = useState(false);
  return <section className="cr-reader-panel h-full overflow-y-auto rounded-[14px] border border-[#e0e0e0] bg-white p-5" aria-label="所选内容翻译">
    <div className="mb-5 flex items-center justify-between gap-3 text-sm text-zinc-500"><span>所选内容翻译</span>
      <button type="button" aria-expanded={showSource} className="underline" onClick={() => setShowSource(value => !value)}>{showSource ? "隐藏原文" : "对照原文"}</button></div>
    {showSource && <p className="mb-5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-500" data-selection-source>{context.word}</p>}
    <div className="whitespace-pre-wrap text-base leading-relaxed" data-selection-translation aria-live="polite">{result.text}</div>
    {result.loading && <p className="mt-4 text-sm text-zinc-500" role="status">正在翻译…</p>}
    {result.notice && <p className="mt-4 text-sm text-zinc-500" role="status">{result.notice} <button type="button" className="underline" onClick={result.retry}>重试</button></p>}
  </section>;
}
