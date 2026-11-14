"use client";
import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';
import {captureDocumentZoomAnchor,restoreDocumentZoomAnchor,type DocumentZoomAnchor} from '@/lib/documentZoomAnchor';

/** Retain the reading point through synchronous scaling and late PDF/Word layout.
 * Real user navigation cancels retention immediately, rather than fighting it.
 */
export function useDocumentZoomAnchor(root:RefObject<HTMLDivElement|null>,scroller:RefObject<HTMLDivElement|null>,revision:string){
 const active=useRef<DocumentZoomAnchor|null>(null);
 const stop=useRef<(()=>void)|null>(null);
 const restore=()=>{if(active.current&&scroller.current)restoreDocumentZoomAnchor(active.current,scroller.current);};
 useLayoutEffect(()=>{restore();});
 useEffect(()=>()=>stop.current?.(),[]);
 function capture(){
  stop.current?.();
  if(!root.current||!scroller.current)return;
  const anchor=captureDocumentZoomAnchor(root.current,scroller.current);if(!anchor)return;
  active.current=anchor;
  let frame=0;
  const previous=anchor.vertical.style.overflowAnchor;
  anchor.vertical.style.overflowAnchor='none';
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;restore();});};
  const observer=new MutationObserver(schedule);observer.observe(scroller.current,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
  const resize=new ResizeObserver(schedule);resize.observe(root.current);resize.observe(anchor.element);
  const cancel=()=>stop.current?.();
  const pointer=(event:Event)=>{if(!(event.target as Element)?.closest?.('[data-document-toolbar]'))cancel();};
  const key=(event:KeyboardEvent)=>{if(/^(Arrow|Page|Home|End| )/.test(event.key))cancel();};
  window.addEventListener('wheel',cancel,{passive:true});window.addEventListener('touchstart',cancel,{passive:true});window.addEventListener('pointerdown',pointer,true);window.addEventListener('keydown',key,true);
  const timer=setTimeout(cancel,4500);
  stop.current=()=>{active.current=null;clearTimeout(timer);cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();anchor.vertical.style.overflowAnchor=previous;window.removeEventListener('wheel',cancel);window.removeEventListener('touchstart',cancel);window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('keydown',key,true);stop.current=null;};
  schedule();
 }
 // Keep the hook tied to document identity without resetting between zoom clicks.
 useEffect(()=>()=>stop.current?.(),[revision]);
 return capture;
}
