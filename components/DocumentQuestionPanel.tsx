"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { documentTranslationContext } from "@/lib/documentTranslationContext";
import { DOCUMENT_QUESTION_EVENT, documentQuestionScope, readDocumentQuestions, saveDocumentQuestion, type DocumentQuestionTurn as Turn } from "@/lib/documentQuestionHistory";

export default function DocumentQuestionPanel({ article, context, owner }: {article:ImportedArticle;context:WordContext|null;owner:string}) {
  const [question,setQuestion]=useState(""), [turns,setTurns]=useState<Turn[]>([]), [busy,setBusy]=useState(false), [notice,setNotice]=useState("");
  const [external,setExternal]=useState(true), [query,setQuery]=useState("");
  const [ready,setReady]=useState(false);
  const scope=documentQuestionScope(owner,article.document!.id);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{
    let current=true;
    let revision=0;
    setReady(false);setTurns([]);
    const reload=()=>{
      const request=++revision;
      readDocumentQuestions(scope).then(rows=>{if(current && request===revision){setTurns(rows);setReady(true);}})
        .catch(()=>{if(current && request===revision){setReady(true);setNotice("暂时无法读取本机问答历史，仍可提问；请刷新后重试读取。");}});
    };
    const onHistory=(event:Event)=>{const changed=(event as CustomEvent<{scope?:string}>).detail?.scope;if(!changed || changed===scope)reload();};
    window.addEventListener(DOCUMENT_QUESTION_EVENT,onHistory);
    reload();
    return ()=>{current=false;window.removeEventListener(DOCUMENT_QUESTION_EVENT,onHistory);active.current?.abort();};
  },[scope]);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function ask(event:React.FormEvent) {
    event.preventDefault(); const q=question.trim(); if(!q || busy || !ready)return;
    const controller=new AbortController(); active.current?.abort();active.current=controller;setBusy(true);setNotice("");
    const all=createArticleTranslationBlocks("",article,"context");
    const terms=q.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const targets=all.filter(b=>b.text.includes(context?.word ?? "\u0000") || terms.some(t=>b.text.toLowerCase().includes(t)) || /conclusion|summary|concluding/i.test(b.text.slice(0,50)));
    const blocks=documentTranslationContext(all,[...targets,...all.slice(-8)]);
    try {
      const response=await fetch("/api/ask-sentence",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({word:context?.word.slice(0,12000) ?? "",sentence:context?.sentence ?? "",previousSentence:context?.previousSentence ?? "",nextSentence:context?.nextSentence ?? "",question:q,document:{title:article.title ?? "当前文档",blocks},history:turns.slice(-4).map(({question,answer})=>({question,answer})),autoSearch:external,...(external && query.trim()?{searchQuery:query.trim()}: {})})});
      const data=await response.json();if(!response.ok || typeof data.answer!=="string" || !data.answer.trim())throw Error(response.status===401?"请登录后继续提问。":"暂时未能取得回答，请稍后重试。");
      if(active.current!==controller || controller.signal.aborted)return;
      const turn:Turn={id:crypto.randomUUID(),createdAt:new Date().toISOString(),question:q,answer:data.answer,sources:data.sources,notice:data.searchNotice};
      setTurns(old=>[...old,turn]);setQuestion("");
      try{await saveDocumentQuestion(scope,turn);}catch{if(active.current===controller)setNotice("回答已生成，但本机历史保存失败。请复制保留此回答。");}
    }catch(error){if(!controller.signal.aborted)setNotice(error instanceof Error && error.message.startsWith("请登录")?error.message:"暂时未能取得回答，问题已保留，可以重试。");}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  return <details className="mb-5 border-b border-[#e0e0e0] pb-4" data-document-question>
    <summary className="cursor-pointer text-sm font-semibold">继续问 AI{turns.length>0?` · ${turns.length} 条历史`:""}</summary>
    <p className="mt-2 text-xs leading-5 text-zinc-600">直接解答知识问题，再结合论文解释。历史按账号和 PDF 自动同步到云端；同一账号在其他设备同步后可继续查看，离线记录会在联网后补传。</p>
    {!ready && !notice && <p role="status" className="mt-2 text-xs">正在读取历史…</p>}
    <div className="mt-3 max-h-[55vh] overflow-y-auto space-y-4" aria-live="polite">{turns.map(turn=><div key={turn.id}>
      <p className="text-sm font-semibold">{turn.question}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.answer}</p>
      {turn.notice && <p className="mt-2 text-xs text-zinc-500">{turn.notice}</p>}
      {!!turn.sources?.length && <ul className="mt-2 space-y-1 text-xs">{turn.sources.map((s,j)=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">[{j+1}] {s.title}</a></li>)}</ul>}
    </div>)}</div>
    <form onSubmit={ask} className="mt-3 space-y-3">
      <textarea aria-label="向 AI 提问这篇文档" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} rows={3} placeholder="例如：单宁酸是什么？它在这篇论文里起什么作用？" className="w-full resize-y rounded-lg border border-zinc-300 p-3 text-sm" />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={external} onChange={e=>setExternal(e.target.checked)} />自动检索外部知识</label>
      {external && <label className="block text-xs">检索关键词（可选）<input aria-label="外部资料检索关键词" value={query} onChange={e=>setQuery(e.target.value)} maxLength={150} placeholder="留空时由 AI 根据问题确定" className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" /><span className="mt-1 block text-zinc-600">仅向百科、PubChem 和学术检索发送简短知识关键词，不发送论文全文或对话。</span></label>}
      <button type="submit" disabled={busy || !ready || !question.trim()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm text-white disabled:opacity-50">{busy?"正在检索并回答…":"发送问题"}</button>
      {notice && <p role="status" className="text-sm text-zinc-600">{notice}</p>}
    </form>
  </details>;
}
