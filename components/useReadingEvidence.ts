"use client";
import { useEffect, useRef } from "react";
import { STUDY_VIEW_EVENT } from "@/lib/studyNavigation";
import { LearningActivity, claimLearningTab } from "@/lib/learningActivity";
export function useReadingEvidence(owner:string,article:string,word:string){
  const words=useRef(new Set<string>()),active=useRef(false);
  useEffect(()=>{words.current.clear();},[owner]);
  useEffect(()=>{if(word&&active.current)words.current.add(word);},[word]);
  useEffect(()=>{
    if(!owner||!article)return;
    const clock=new LearningActivity(45000),id=crypto.randomUUID();
    let studyOpen=false,seconds=0,sending=false;
    const foreground=()=>document.visibilityState==="visible"&&document.hasFocus()&&!studyOpen&&!document.querySelector('dialog[open], [data-study-menu]');
    const activity=(event:Event)=>{
      if(!event.isTrusted)return;
      if(!foreground()){clock.pause();active.current=false;return;}
      const target=event.target instanceof Element?event.target:null;
      const inArticle=target?.closest('[data-learning-surface="reading"]');
      const keyboard=event instanceof KeyboardEvent&&["ArrowDown","ArrowUp","PageDown","PageUp"," "].includes(event.key)&&target===document.body;
      if(!inArticle&&!keyboard){clock.pause();active.current=false;return;}
      if(!claimLearningTab(owner,id))clock.pause();
      clock.touch(performance.now(),true);active.current=true;seconds+=clock.take()/1000;
    };
    const send=()=>{
      const batch=[...words.current].slice(0,30),amount=Math.min(30,Math.floor(seconds));
      if(sending||(!amount&&!batch.length))return;
      sending=true;seconds-=amount;
      void fetch("/api/study/reading",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json","X-Context-Account":owner},body:JSON.stringify({seconds:amount,words:batch,article:article.slice(0,160),evidenceVersion:2})}).then(r=>{if(r.ok){for(const w of batch)words.current.delete(w);}else seconds+=amount;}).catch(()=>{seconds+=amount;}).finally(()=>{sending=false;});
    };
    const pause=()=>{clock.pause();active.current=false;send();};
    const study=(e:Event)=>{studyOpen=Boolean((e as CustomEvent).detail);pause();};
    const visibility=()=>{if(document.visibilityState!=="visible")pause();};
    const events=["pointerdown","wheel","keydown","touchmove"];
    for(const e of events)window.addEventListener(e,activity,{passive:true});
    window.addEventListener("blur",pause);document.addEventListener("visibilitychange",visibility);window.addEventListener(STUDY_VIEW_EVENT,study);
    const timer=setInterval(send,15000);
    return()=>{pause();clearInterval(timer);for(const e of events)window.removeEventListener(e,activity);window.removeEventListener("blur",pause);document.removeEventListener("visibilitychange",visibility);window.removeEventListener(STUDY_VIEW_EVENT,study);};
  },[owner,article]);
}
