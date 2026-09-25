"use client";
import {useCallback,useEffect,useRef,useState} from "react";

// Visibility is a projection of availability; pausing never waits for animation.
export function useCetQuestionDock(key:string|undefined,available:boolean) {
  const [intent,setIntent]=useState(false);
  const [ready,setReady]=useState(false);
  const visited=useRef(new Set<string>());
  useEffect(()=>{setIntent(false);setReady(false);},[key]);
  useEffect(()=>{
    if(!key||!available)return;
    let first=0,second=0,delay=0;
    const reveal=()=>{
      if(document.hidden||visited.current.has(key))return;
      first=requestAnimationFrame(()=>{setReady(true);second=requestAnimationFrame(()=>{
        delay=window.setTimeout(()=>{if(document.hidden||visited.current.has(key))return;visited.current.add(key);setIntent(true);},120);
      });});
    };
    reveal();document.addEventListener('visibilitychange',reveal);
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(delay);document.removeEventListener('visibilitychange',reveal);};
  },[key,available]);
  const close=useCallback(()=>{if(key)visited.current.add(key);setIntent(false);},[key]);
  const open=useCallback(()=>{if(key)visited.current.add(key);setReady(true);setIntent(true);},[key]);
  return {open:available&&ready&&intent,ready:available&&ready,close,show:open};
}
