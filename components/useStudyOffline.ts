"use client";
import {useCallback,useEffect,useRef} from "react";
import type {StudySnapshot} from "@/types/study";
import {updateStudyLocalRecord} from "@/lib/studyOfflineStore";
import {acknowledgeStudyEvent,canUndoStudy,localReceipt,projectStudyRecord,type StudyLocalEvent,type StudyLocalRecord,type StudyLocalAck} from "@/lib/studyOffline";

export function useStudyOffline(owner:string,network:<T>(body?:unknown)=>Promise<T>,accept:(s:StudySnapshot)=>void,active=true){
  const current=useRef<StudyLocalRecord|null>(null),alive=useRef(true),running=useRef(false);
  const refreshing=useRef(false),refreshedAt=useRef(0),revision=useRef("");
  const callbacks=useRef({network,accept});callbacks.current={network,accept};
  const drainRef=useRef<()=>Promise<void>>(async()=>{});
  const publish=(r:StudyLocalRecord)=>{current.current=r;if(alive.current)callbacks.current.accept(projectStudyRecord(r));};
  const drain=useCallback(async()=>{
    if(running.current||!alive.current||!current.current||typeof navigator!=="undefined"&&!navigator.onLine)return;
    running.current=true;
    try{
      while(alive.current){
        const record=await updateStudyLocalRecord(owner,r=>r);if(!record)return;
        const event=record.events[0];if(!event)return;
        const response=await callbacks.current.network<{ack:StudyLocalAck}>({op:"local_event",event});
        if(response.ack?.id!==event.id||!Number.isFinite(Date.parse(response.ack.serverNow)))throw new Error("Invalid study acknowledgement");
        const merged=await updateStudyLocalRecord(owner,r=>r?acknowledgeStudyEvent(r,response.ack):null);
        if(merged)publish(merged);
      }
    }catch{/* The durable journal retries on reconnection and while the app is open. */}
    finally{running.current=false;}
  },[owner]);
  drainRef.current=drain;
  const refresh=useCallback(async(force=false)=>{
    if(!owner||!alive.current||refreshing.current||!navigator.onLine||typeof indexedDB==="undefined")return;
    refreshing.current=true;
    try{
      await drainRef.current();
      if(running.current)return;
      const before=await updateStudyLocalRecord(owner,r=>r);
      if(!before||before.events.length)return;
      const probe=await callbacks.current.network<{revision:string}>({op:"local_revision"});
      if(!force&&probe.revision&&probe.revision===revision.current)return;
      const seed=await callbacks.current.network<StudySnapshot>({op:"local_refresh"});
      if(!alive.current)return;
      let applied=false;
      const merged=await updateStudyLocalRecord(owner,r=>{
        // Local answers and acknowledgements during this request win.
        // Retry later without replacing an unacknowledged answer.
        if(!r||r.events.length||r.base.serverNow!==before.base.serverNow||Date.parse(seed.serverNow)<Date.parse(r.base.serverNow))return r;
        applied=true;return {...r,base:seed,clockOffset:Date.parse(seed.serverNow)-Date.now()};
      });
      if(applied&&merged){revision.current=probe.revision;refreshedAt.current=Date.now();publish(merged);}
    }catch{/* Keep the durable snapshot and retry silently. */}
    finally{refreshing.current=false;}
  },[owner]);
  useEffect(()=>{
    alive.current=true;
    const resume=()=>{void drainRef.current();};
    const timer=setInterval(resume,15000);window.addEventListener("online",resume);
    return()=>{alive.current=false;clearInterval(timer);window.removeEventListener("online",resume);};
  },[owner]);
  useEffect(()=>{
    if(!active)return;
    const check=()=>{if(document.visibilityState==="visible")void refresh();};
    const resume=()=>{if(document.visibilityState==="visible")void refresh(true);};
    resume();
    const timer=setInterval(check,10000);
    window.addEventListener("focus",resume);window.addEventListener("online",resume);
    document.addEventListener("visibilitychange",resume);
    return()=>{clearInterval(timer);window.removeEventListener("focus",resume);window.removeEventListener("online",resume);document.removeEventListener("visibilitychange",resume);};
  },[active,refresh]);
  const api=useCallback(async<T,>(body?:unknown):Promise<T>=>{
    const b=body as Record<string,unknown>|undefined,op=b?.op;
    if(typeof indexedDB==="undefined")return callbacks.current.network<T>(body);
    let record=await updateStudyLocalRecord(owner,r=>r);
    if(!record){
      const response=await callbacks.current.network<T>(body);
      const seed=response as StudySnapshot;
      if(seed?.offlinePermit&&Array.isArray(seed.cards)){
        record=await updateStudyLocalRecord(owner,r=>r??{owner,base:seed,events:[],clockOffset:Date.parse(seed.serverNow)-Date.now()});current.current=record;
      }
      return response;
    }
    current.current=record;
    if(!op||op==="start"||op==="prepare"){
      // Return local state immediately. A background refresh may replace only
      // the base, never the unsent journal or the learner's displayed question.
      if(Date.now()-refreshedAt.current>=1000)void refresh(true);
      return projectStudyRecord(record) as T;
    }
    if(op==="present")return {token:crypto.randomUUID()} as T;
    if(op==="review"||op==="undo"||op==="settings"){
      const event:StudyLocalEvent={id:op==="review"?String(b!.id):crypto.randomUUID(),at:new Date(Date.now()+(record.clockOffset??0)).toISOString(),permit:record.base.offlinePermit!,
        ...(op==="review"?{kind:"review" as const,cardId:String(b!.cardId),answer:b!.answer as "forgot",activeMs:Number(b!.activeMs)}:
          op==="undo"?{kind:"undo" as const,reviewId:String(b!.id)}:{kind:"settings" as const,settings:b!.settings as StudySnapshot["settings"]})};
      record=await updateStudyLocalRecord(owner,r=>{
        if(!r)throw new Error("本机学习记录无法读取，请重新打开。");
        const view=projectStudyRecord(r);
        if(event.kind==="undo"&&!canUndoStudy(view,event.reviewId,new Date(event.at)))throw new Error("这次作答已无法撤回。");
        if(event.kind==="review"&&!view.cards.some(c=>c.id===event.cardId&&!c.suspended))throw new Error("这个词已移除。");
        const next={...r,events:r.events.some(e=>e.id===event.id)||r.base.reviews.some(e=>e.id===event.id)?r.events:[...r.events,event]};
        projectStudyRecord(next);return next;
      });
      current.current=record;
      const snapshot=projectStudyRecord(record!);
      // The local durable acknowledgement is distinct from server credit.
      void drainRef.current();
      return (op==="review"?{saved:true,id:event.id,receipt:localReceipt(snapshot,event.id)}:snapshot) as T;
    }
    await drainRef.current();
    const response=await callbacks.current.network<T>(body);
    const envelope=response as {snapshot?:StudySnapshot};
    const seed=envelope?.snapshot??response as StudySnapshot;
    if(seed?.offlinePermit&&Array.isArray(seed.cards)){
      const merged=await updateStudyLocalRecord(owner,r=>r?{...r,base:seed}:null);
      if(merged){current.current=merged;const projected=projectStudyRecord(merged);return (envelope.snapshot?{...envelope,snapshot:projected}:projected) as T;}
    }
    return response;
  },[owner,refresh]);
  return {api};
}
