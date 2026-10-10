"use client";
import { useEffect, useRef } from "react";
import { LearningActivity, claimLearningTab } from "@/lib/learningActivity";
export function useStudyTimer(enabled:boolean,identity:string,owner=""){
  const elapsed=useRef(0);
  useEffect(()=>{elapsed.current=0;},[identity]);
  useEffect(()=>{
    if(!enabled)return;
    const clock=new LearningActivity(30000),id=crypto.randomUUID();
    const foreground=()=>document.visibilityState==="visible"&&document.hasFocus();
    if(foreground()){claimLearningTab(owner,id);clock.start(performance.now());}
    const touch=(event:Event)=>{
      if(!event.isTrusted)return;
      const target=event.target instanceof Element?event.target:null;
      const keyboard=event instanceof KeyboardEvent&&["1","2","3","Enter"," "].includes(event.key)&&!target?.closest("input,textarea");
      if(!target?.closest('[data-learning-surface="study"]')&&!keyboard){clock.pause();return;}
      if(!claimLearningTab(owner,id))clock.pause();
      clock.touch(performance.now(),foreground());elapsed.current+=clock.take();
    };
    const pause=()=>clock.pause();
    for(const e of ["pointerdown","keydown","wheel","touchmove"])window.addEventListener(e,touch,{passive:true,capture:true});
    window.addEventListener("blur",pause);document.addEventListener("visibilitychange",pause);
    return()=>{for(const e of ["pointerdown","keydown","wheel","touchmove"])window.removeEventListener(e,touch,true);window.removeEventListener("blur",pause);document.removeEventListener("visibilitychange",pause);};
  },[enabled,identity,owner]);
  return()=>Math.min(60000,Math.round(elapsed.current));
}
