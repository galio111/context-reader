"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { documentTranslationContext } from "@/lib/documentTranslationContext";
import { DOCUMENT_QUESTION_EVENT, documentQuestionScope, readDocumentQuestions, type DocumentQuestionTurn as Turn } from "@/lib/documentQuestionHistory";

import { getDocumentQuestionJob, startDocumentQuestionJob, subscribeDocumentQuestionJob } from "@/lib/documentQuestionJobs";

export default function DocumentQuestionPanel({ article, context, owner }: { article: ImportedArticle; context: WordContext | null; owner: string }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [currentId, setCurrentId] = useState("");
  const currentIdRef = useRef("");
  const [preview, setPreview] = useState<{ id: string; question: string; top: number } | null>(null);
  const scope = documentQuestionScope(owner, article.document!.id);
  const job = useSyncExternalStore(
    useCallback(listener => subscribeDocumentQuestionJob(scope, listener), [scope]),
    useCallback(() => getDocumentQuestionJob(scope), [scope]),
    () => null,
  );
  const pending = job?.turn ?? null;
  const busy = job?.loading ?? false;
  const history = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const directory = useRef<HTMLElement>(null);
  const turnNodes = useRef(new Map<string, HTMLElement>());
  const jumpTarget = useRef<string | null>(null);
  const previewId = useId();
  const sectionPrefix = useId();
  const visibleTurns = pending && !turns.some(turn => turn.id === pending.id) ? [...turns, pending] : turns;

  function jumpTo(id: string, smooth = false) {
    const viewport = history.current;
    const node = turnNodes.current.get(id);
    if (!viewport || !node) return;
    const top = viewport.scrollTop + node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    // Scroll only history, never the surrounding paper or explanation panel.
    viewport.scrollTo?.({ top, behavior: smooth && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
    currentIdRef.current = id; setCurrentId(id);
  }

  useEffect(() => {
    let current = true;
    let revision = 0;
    jumpTarget.current = null; currentIdRef.current = "";
    setReady(false); setTurns([]);
    const existing = getDocumentQuestionJob(scope);
    if (existing) jumpTarget.current = existing.turn.id;
    setQuestion(existing && !existing.turn.answer ? existing.turn.question : ""); setNotice(""); setCurrentId(""); setPreview(null);
    const reload = () => {
      const request = ++revision;
      readDocumentQuestions(scope).then(rows => {
        if (current && request === revision) { setTurns(rows); setReady(true); }
      }).catch(() => {
        if (current && request === revision) {
          setReady(true);
          setNotice("暂时无法读取本机问答历史，仍可提问；请刷新后重试读取。");
        }
      });
    };
    const onHistory = (event: Event) => {
      const changed = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!changed || changed === scope) reload();
    };
    window.addEventListener(DOCUMENT_QUESTION_EVENT, onHistory);
    reload();
    return () => { current = false; window.removeEventListener(DOCUMENT_QUESTION_EVENT, onHistory); };
  }, [scope]);

  useEffect(() => {
    // Only local submission requests a jump. Sync must not interrupt reading.
    if (jumpTarget.current && turnNodes.current.has(jumpTarget.current)) {
      jumpTo(jumpTarget.current); jumpTarget.current = null;
    }
  }, [turns, pending]);

  useEffect(() => {
    if (job?.turn.answer) {
      setQuestion(value => value.trim() === job.turn.question ? "" : value);
      if (currentIdRef.current === job.turn.id) jumpTo(job.turn.id);
    }
  }, [job]);

  useEffect(() => {
    const rail = directory.current;
    const marker = rail?.querySelector<HTMLElement>("[aria-current]");
    if (!rail || !marker) return;
    const bounds = rail.getBoundingClientRect(), target = marker.getBoundingClientRect();
    if (target.top < bounds.top) rail.scrollTop += target.top - bounds.top;
    else if (target.bottom > bounds.bottom) rail.scrollTop += target.bottom - bounds.bottom;
  }, [currentId, visibleTurns.length]);

  function trackPosition() {
    const viewport = history.current;
    if (!viewport) return;
    const top = viewport.getBoundingClientRect().top;
    let id = visibleTurns[0]?.id ?? "";
    for (const turn of visibleTurns) {
      const node = turnNodes.current.get(turn.id);
      if (!node || node.getBoundingClientRect().top > top + 32) break;
      id = turn.id;
    }
    if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) id = visibleTurns.at(-1)?.id ?? id;
    currentIdRef.current = id; setCurrentId(id); setPreview(null);
  }

  function showPreview(turn: Turn, button: HTMLButtonElement) {
    const bounds = shell.current?.getBoundingClientRect();
    if (!bounds) return;
    setPreview({ id: turn.id, question: turn.question, top: Math.max(0, Math.min(button.getBoundingClientRect().top - bounds.top, bounds.height - 100)) });
  }

  function ask(event: React.FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || busy || !ready) return;
    setNotice(""); setPreview(null);
    const all = createArticleTranslationBlocks("", article, "context");
    const terms = q.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const targets = all.filter(b => b.text.includes(context?.word ?? "\u0000") || terms.some(t => b.text.toLowerCase().includes(t)) || /conclusion|summary|concluding/i.test(b.text.slice(0, 50)));
    const blocks = documentTranslationContext(all, [...targets, ...all.slice(-8)]);
    startDocumentQuestionJob(scope, { word: context?.word.slice(0, 12000) ?? "", sentence: context?.sentence ?? "", previousSentence: context?.previousSentence ?? "", nextSentence: context?.nextSentence ?? "", question: q, document: { title: article.title ?? "当前文档", blocks }, history: turns.slice(-4).map(({ question, answer }) => ({ question, answer })), autoSearch: true });
    jumpTarget.current = getDocumentQuestionJob(scope)?.turn.id ?? null;
  }

  return <details className="mb-5 border-b border-[#e0e0e0] pb-4" data-document-question onToggle={event => {
    setPreview(null);
    if (event.currentTarget.open && currentId) jumpTo(currentId);
  }}>
    <summary className="cursor-pointer text-sm font-semibold">继续问 AI{turns.length > 0 ? ` · ${turns.length} 条历史` : ""}</summary>
    <form onSubmit={ask} className="mt-3 space-y-3">
      <textarea aria-label="向 AI 提问这篇文档" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} onKeyDown={event => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }} maxLength={1000} rows={3} placeholder="例如：单宁酸是什么？它在这篇文档里起什么作用？" className="w-full resize-y rounded-lg border border-zinc-300 p-3 text-sm" />
      <p className="text-xs text-zinc-600">Enter 发送，Shift + Enter 换行</p>
      <button type="submit" disabled={busy || !ready || !question.trim()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "正在检索并回答…" : "发送问题"}</button>
      {(job?.error || notice) && <p role="status" className="text-sm text-zinc-600">{job?.error || notice}</p>}
    </form>
    {!ready && !notice && <p role="status" className="mt-2 text-xs">正在读取历史…</p>}
    <div className="cr-document-question-history" ref={shell} onPointerLeave={() => setPreview(null)}>
      <div ref={history} className="cr-document-question-turns" onScroll={trackPosition} aria-label="文档问答历史">
        {visibleTurns.map(turn => <section key={turn.id} id={`${sectionPrefix}-${turn.id}`} data-question-id={turn.id} style={turn.id === job?.turn.id ? { minHeight: "55vh" } : undefined} ref={node => { if (node) turnNodes.current.set(turn.id, node); else turnNodes.current.delete(turn.id); }}>
          <h3 className="text-sm font-semibold">{turn.question}</h3>
          {turn.id === pending?.id && !turn.answer ? <p role="status" className={busy ? "cr-document-question-waiting mt-2 text-sm" : "mt-2 text-sm"}>{busy ? "正在检索并回答…" : "回答暂未完成，可重新发送此问题。"}</p> : <p aria-live={turn.id === job?.turn.id ? "polite" : undefined} className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.answer}</p>}
        </section>)}
      </div>
      {visibleTurns.length > 0 && <nav ref={directory} className="cr-document-question-directory" aria-label="问题目录" onKeyDown={event => { if (event.key === "Escape") setPreview(null); }}>
        {visibleTurns.map((turn, index) => <button key={turn.id} type="button" className="cr-document-question-marker" aria-label={`跳转到问题 ${index + 1}：${turn.question}`} aria-controls={`${sectionPrefix}-${turn.id}`} aria-current={(currentId || visibleTurns[0]?.id) === turn.id ? "location" : undefined} aria-describedby={preview?.id === turn.id ? previewId : undefined} onPointerEnter={event => showPreview(turn, event.currentTarget)} onFocus={event => showPreview(turn, event.currentTarget)} onBlur={() => setPreview(null)} onClick={() => { jumpTo(turn.id, true); setPreview(null); }}><span aria-hidden="true" /></button>)}
      </nav>}
      {preview && <div id={previewId} role="tooltip" className="cr-document-question-preview" style={{ top: preview.top }}>{preview.question}</div>}
    </div>

  </details>;
}
