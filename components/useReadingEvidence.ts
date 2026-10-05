"use client";
import { useEffect, useRef } from "react";
import { STUDY_VIEW_EVENT } from "@/lib/studyNavigation";
export function useReadingEvidence(owner: string, article: string, word: string) {
 const wordRef=useRef(new Set<string>());
 useEffect(()=>{wordRef.current.clear();},[owner]);
 useEffect(()=>{if(word)wordRef.current.add(word);},[word,owner]);
 useEffect(()=>{
  if(!owner||!article)return;
  let last=Date.now(),interaction=last,seconds=0,studyOpen=false;
  const activity=()=>{interaction=Date.now();};
  const study=(event:Event)=>{studyOpen=Boolean((event as CustomEvent).detail);};
  const timer=setInterval(()=>{
   const now=Date.now();
   if(document.visibilityState==="visible"&&document.hasFocus()&&!studyOpen&&now-interaction<45000)seconds+=Math.min(2,(now-last)/1000);
   last=now;
  },1000);
  const send=setInterval(()=>{
   const words=[...wordRef.current].slice(0,30);
   if(seconds<10&&!words.length)return;
   const amount=Math.min(30,Math.floor(seconds));seconds=0;
   void fetch("/api/study/reading",{method:"POST",headers:{"Content-Type":"application/json","X-Context-Account":owner},body:JSON.stringify({seconds:amount,words,article:article.slice(0,160)})}).then(r=>{if(r.ok)for(const word of words)wordRef.current.delete(word);}).catch(()=>{});
  },30000);
  for(const event of ["pointerdown","pointermove","keydown","scroll","touchstart"])window.addEventListener(event,activity,{passive:true});
  window.addEventListener(STUDY_VIEW_EVENT,study);
  return()=>{clearInterval(timer);clearInterval(send);for(const event of ["pointerdown","pointermove","keydown","scroll","touchstart"])window.removeEventListener(event,activity);window.removeEventListener(STUDY_VIEW_EVENT,study);};
 },[owner,article]);
}
