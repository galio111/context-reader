"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { documentTranslationContext } from "@/lib/documentTranslationContext";

type Turn = { question: string; answer: string; sources?: {title:string;url:string}[]; notice?: string };
export default function DocumentQuestionPanel({ article, context }: {article:ImportedArticle;context:WordContext|null}) {
  const [question,setQuestion]=useState(""), [turns,setTurns]=useState<Turn[]>([]), [busy,setBusy]=useState(false), [notice,setNotice]=useState("");
  const [external,setExternal]=useState(false), [query,setQuery]=useState(context && context.word.trim().split(/\s+/).length <= 5 ? context.word.slice(0,150) : "");
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function ask(event:React.FormEvent) {
    event.preventDefault(); const q=question.trim(); if(!q || busy)return;
    const controller=new AbortController(); active.current?.abort();active.current=controller;setBusy(true);setNotice("");
    const all=createArticleTranslationBlocks("",article,"context");
    const terms=q.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const targets=all.filter(b=>b.text.includes(context?.word ?? "\u0000") || terms.some(t=>b.text.toLowerCase().includes(t)) || /conclusion|summary|concluding/i.test(b.text.slice(0,50)));
    const blocks=documentTranslationContext(all,[...targets,...all.slice(-8)]);
    try {
      const response=await fetch("/api/ask-sentence",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({word:context?.word.slice(0,12000) ?? "",sentence:context?.sentence ?? "",previousSentence:context?.previousSentence ?? "",nextSentence:context?.nextSentence ?? "",question:q,document:{title:article.title ?? "当前文档",blocks},history:turns.slice(-4).map(({question,answer})=>({question,answer})),...(external?{searchQuery:query.trim()}: {})})});
      const data=await response.json();if(!response.ok || typeof data.answer!=="string" || !data.answer.trim())throw Error(response.status===401?"请登录后继续提问。":"暂时未能取得回答，请稍后重试。");
      if(active.current!==controller || controller.signal.aborted)return;
      setTurns(old=>[...old,{question:q,answer:data.answer,sources:data.sources,notice:data.searchNotice}]);setQuestion("");
    }catch(error){if(!controller.signal.aborted)setNotice(error instanceof Error && error.message.startsWith("请登录")?error.message:"暂时未能取得回答，问题已保留，可以重试。");}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  return <details className="mb-5 border-b border-[#e0e0e0] pb-4" data-document-question>
    <summary className="cursor-pointer text-sm font-semibold">继续问 AI</summary>
    <p className="mt-2 text-xs leading-5 text-zinc-500">结合当前选区和整篇文档回答，也可以问术语、实验方法或文章主旨。</p>
    <div className="mt-3 space-y-4" aria-live="polite">{turns.map((turn,i)=><div key={i}>
      <p className="text-sm font-semibold">{turn.question}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.answer}</p>
      {turn.notice && <p className="mt-2 text-xs text-zinc-500">{turn.notice}</p>}
      {!!turn.sources?.length && <ul className="mt-2 space-y-1 text-xs">{turn.sources.map((s,j)=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">[{j+1}] {s.title}</a></li>)}</ul>}
    </div>)}</div>
    <form onSubmit={ask} className="mt-3 space-y-3">
      <textarea aria-label="向 AI 提问这篇文档" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} rows={3} placeholder="例如：单宁酸是什么？它在这篇论文里起什么作用？" className="w-full resize-y rounded-lg border border-zinc-300 p-3 text-sm" />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={external} onChange={e=>setExternal(e.target.checked)} />检索外部资料（百科 / 学术摘要）</label>
      {external && <label className="block text-xs">检索关键词<input aria-label="外部资料检索关键词" value={query} onChange={e=>setQuery(e.target.value)} maxLength={150} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" /><span className="mt-1 block text-zinc-500">只发送此关键词，不向检索网站发送论文内容。</span></label>}
      <button type="submit" disabled={busy || !question.trim() || external && !query.trim()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm text-white disabled:opacity-50">{busy?"正在回答…":"发送问题"}</button>
      {notice && <p role="status" className="text-sm text-zinc-600">{notice}</p>}
    </form>
  </details>;
}
