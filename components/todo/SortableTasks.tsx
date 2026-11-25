"use client";

import {useEffect,useRef,type ReactNode} from "react";
import type {TaskMove} from "./planner-model";

// Keep ordinary touch scrolling native until a stationary hold activates a move.
export function SortableTasks({children,onMove}:{children:ReactNode;onMove:(move:TaskMove)=>void}) {
  const listRef=useRef<HTMLDivElement>(null),callback=useRef(onMove);
  useEffect(()=>{callback.current=onMove},[onMove]);
  useEffect(()=>{
    const list=listRef.current!;
    let source:HTMLElement|null=null, target:HTMLElement|null=null, after=false;
    let active=false, startX=0,startY=0,x=0,y=0,timer=0,frame=0, touchId:number|null=null;
    const listeners=new AbortController();
    const rows=()=>Array.from(list.querySelectorAll<HTMLElement>("[data-order-id]"));
    function clearTarget(){if(target)delete target.dataset.drop;target=null}
    function cancel(){
      window.clearTimeout(timer);cancelAnimationFrame(frame);clearTarget();
      if(source)delete source.dataset.dragging;
      source=null;active=false;touchId=null;
    }
    function locate(){
      clearTarget();
      if(!source?.isConnected){cancel();return}
      const hit=document.elementFromPoint(x,y)?.closest<HTMLElement>("[data-order-id]");
      if(!hit || hit===source || !list.contains(hit))return;
      target=hit;
      const rect=hit.getBoundingClientRect();
      after=y>=rect.top+rect.height/2;
      hit.dataset.drop=after?"after":"before";
    }
    function autoScroll(){
      if(!active)return;
      const delta=y<48?-Math.ceil((48-y)/4):y>innerHeight-48?Math.ceil((y-innerHeight+48)/4):0;
      if(delta){window.scrollBy(0,Math.min(16,Math.max(-16,delta)));locate()}
      if(active)frame=requestAnimationFrame(autoScroll);
    }
    function begin(el:EventTarget|null,px:number,py:number,id:number|null){
      cancel();
      if(!(el instanceof Element) || el.closest("button,input,select,textarea,a,form"))return;
      source=el.closest<HTMLElement>("[data-order-id]");
      if(!source || rows().length<2){cancel();return}
      touchId=id;startX=x=px;startY=y=py;
      timer=window.setTimeout(()=>{
        if(!source?.isConnected){cancel();return}
        source.dataset.dragging="true";active=true;frame=requestAnimationFrame(autoScroll);
      },380);
    }
    function move(px:number,py:number){
      if(!source)return;
      x=px;y=py;
      if(!active){if(Math.hypot(x-startX,y-startY)>8)cancel();return}
      locate();
    }
    function finish(px:number,py:number){
      if(!source)return;
      x=px;y=py;
      if(active)locate();
      const request=active && source && target ? {source:source.dataset.orderId!,target:target.dataset.orderId!,after} : null;
      cancel();if(request)callback.current(request);
    }
    const opts={signal:listeners.signal};
    list.addEventListener("mousedown",e=>{if(e.button===0)begin(e.target,e.clientX,e.clientY,null)},opts);
    window.addEventListener("mousemove",e=>{if(source && touchId===null)move(e.clientX,e.clientY)},opts);
    window.addEventListener("mouseup",e=>{if(touchId===null)finish(e.clientX,e.clientY)},opts);
    list.addEventListener("touchstart",e=>{
      if(e.touches.length!==1){cancel();return}
      const t=e.touches[0];begin(e.target,t.clientX,t.clientY,t.identifier);
    },{...opts,passive:true});
    list.addEventListener("touchmove",e=>{
      if(!source || e.touches.length!==1){cancel();return}
      const t=e.touches[0];if(t.identifier!==touchId)return;
      if(active && e.cancelable)e.preventDefault();
      move(t.clientX,t.clientY);
    },{...opts,passive:false});
    list.addEventListener("touchend",e=>{
      const t=Array.from(e.changedTouches).find(t=>t.identifier===touchId);
      if(!t)return;
      if(active && e.cancelable)e.preventDefault();
      finish(t.clientX,t.clientY);
    },{...opts,passive:false});
    list.addEventListener("contextmenu",e=>{if(source)e.preventDefault()},opts);
    list.addEventListener("touchcancel",cancel,opts);
    window.addEventListener("blur",cancel,opts);
    window.addEventListener("keydown",e=>{if(e.key==="Escape")cancel()},opts);
    list.addEventListener("keydown",e=>{
      if(!e.altKey || !["ArrowUp","ArrowDown"].includes(e.key))return;
      const row=e.target;if(!(row instanceof HTMLElement) || !row.dataset.orderId)return;
      e.preventDefault();const listRows=rows(),down=e.key==="ArrowDown";
      const anchor=listRows[listRows.indexOf(row)+(down?1:-1)];
      if(anchor)callback.current({source:row.dataset.orderId,target:anchor.dataset.orderId!,after:down});
    },opts);
    return ()=>{cancel();listeners.abort()};
  },[]);
  return <div className="td-sort-list" ref={listRef}>{children}</div>;
}
