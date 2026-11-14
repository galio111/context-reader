"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { documentCacheOwner } from "@/lib/documentBinaryCache";
import { getLearningStorage, flushLearningStorage } from "@/lib/learningStorage";
import { captureDocumentPenRects, documentPenKey, paintDocumentPen, readDocumentPenMarks, type DocumentPenMark } from "@/lib/documentPen";
import { clearDocumentSelectionHighlight } from "@/lib/documentSelection";

export function useDocumentPen(id: string, root: RefObject<HTMLDivElement|null>, iframe: RefObject<HTMLIFrameElement|null>, pdf: boolean, revision: string) {
  const [enabled,setEnabled]=useState(false);
  const [marks,setMarks]=useState<DocumentPenMark[]>([]);
  const [notice,setNotice]=useState("");
  const [ready,setReady]=useState(false);
  const current=useRef({enabled,marks,ready});current.current={enabled,marks,ready};
  const key=documentPenKey(documentCacheOwner(),id);
  const content=()=>pdf?root.current:iframe.current?.contentDocument?.body ?? null;
  useEffect(()=>{
    setEnabled(false);setReady(false);setNotice("");setMarks([]);
    try{setMarks(readDocumentPenMarks(getLearningStorage(),key));setReady(true);}
    catch{setNotice("本机划线暂时无法读取，请刷新后重试。");}
  },[key]);
  useEffect(()=>{
    const host=content();if(!host)return;
    let frame=0;
    const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(paint);});
    const watch=()=>observer.observe(host,{childList:true,subtree:true});
    function paint(){observer.disconnect();paintDocumentPen(host!,marks);watch();}
    paint();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
    // The original DOM is rebuilt after PDF paints and Word render/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[marks,pdf,revision]);
  function save(next:DocumentPenMark[]){
    try{getLearningStorage().setItem(key,JSON.stringify(next));setMarks(next);setNotice("");void flushLearningStorage().catch(()=>setNotice("划线尚未写入本机，请保持网页打开后重试。"));}
    catch{setNotice("划线未能保存，请稍后重试。");}
  }
  function capture(){
    if(!current.current.enabled)return false;
    const host=content();if(!host || !current.current.ready)return true;
    const rects=captureDocumentPenRects(host);
    if(rects.length){
      if(current.current.marks.length>=1000 || current.current.marks.reduce((n,m)=>n+m.rects.length,0)+rects.length>5000){setNotice("本篇划线已达上限，请先撤销部分划线。");return true;}
      const last=current.current.marks.at(-1);
      if(!last || JSON.stringify(last.rects)!==JSON.stringify(rects))save([...current.current.marks,{id:crypto.randomUUID(),rects}]);
      host.ownerDocument.getSelection()?.removeAllRanges();clearDocumentSelectionHighlight(host);
    }
    return true;
  }
  return {enabled,ready,count:marks.length,notice,capture,toggle:()=>{setEnabled(value=>!value);const host=content();host?.ownerDocument.getSelection()?.removeAllRanges();if(host)clearDocumentSelectionHighlight(host);},undo:()=>save(current.current.marks.slice(0,-1))};
}
