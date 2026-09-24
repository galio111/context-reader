"use client";
import { useEffect, useRef, useState } from "react";
import { useDocumentScrollLock } from "@/components/useDocumentScrollLock";
import { CetLibrary, type CetEntry } from "./CetLibrary";
export function CetLibraryDialog({onClose,onOpen,confirmBeforeOpen=false}:{onClose:()=>void;onOpen:(entry:CetEntry)=>void|boolean|Promise<void|boolean>;confirmBeforeOpen?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);
 const [pending,setPending]=useState<CetEntry|null>(null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 useDocumentScrollLock(true);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 async function open(entry:CetEntry) {
  if(saving)return;
  setSaving(true);setError("");
  try { if(await onOpen(entry)===false)setError("文章修改尚未保存成功，请返回文章重试。原文和修改仍保留。"); }
  catch { setError("暂时无法打开真题，请稍后重试。当前文章仍保留。"); }
  finally { setSaving(false); }
 }
 return <dialog ref={ref} className="cet-sheet cet-sheet-left" aria-label="选择真题" onCancel={e=>{e.preventDefault();if(!saving)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!saving)onClose();}}><section><header><h2>选择真题</h2><button disabled={saving} onClick={onClose} aria-label="关闭选择真题">×</button></header><div className="cet-sheet-body">{pending?<div className="cet-test-settings"><h3>保存修改后打开真题？</h3><p>当前文章有未保存的编辑。保存成功后再进入所选真题。</p>{error&&<p role="alert">{error}</p>}<div className="cet-dialog-actions"><button disabled={saving} onClick={onClose}>留在当前文章</button><button disabled={saving} onClick={()=>void open(pending)}>{saving?"正在保存…":"保存并打开真题"}</button></div></div>:<CetLibrary compact onOpen={entry=>{if(confirmBeforeOpen)setPending(entry);else void open(entry);}}/>}</div></section></dialog>;
}
