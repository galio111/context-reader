"use client";
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import type { CetListeningAudio, CetListeningPlayback } from "@/types/cet";

const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;

/** One lazily loaded player. Exam controls never expose pause, seek or speed. */
export type CetListeningController = { checkpoint: () => void };
export function CetListeningPlayer({audio,testing,stopped,blocked=false,initial,onCheckpoint,onRunningChange,controller}:{
  audio:CetListeningAudio; testing:boolean; stopped:boolean; blocked?:boolean; initial?:CetListeningPlayback;
  onCheckpoint:(position:number,state:CetListeningPlayback["state"])=>void;
  onRunningChange:(running:boolean)=>void;
  controller?:RefObject<CetListeningController|null>;
}) {
  const element=useRef<HTMLAudioElement>(null);
  const callbacks=useRef({onCheckpoint,onRunningChange});callbacks.current={onCheckpoint,onRunningChange};
  const [loaded,setLoaded]=useState(false),[running,setRunning]=useState(false),[loading,setLoading]=useState(false);
  const [position,setPosition]=useState(stopped?0:initial?.position||0);
  const [message,setMessage]=useState(testing&&['playing','interrupted'].includes(initial?.state||'')?'上次播放已中断，请从记录位置继续。':'');
  const [ended,setEnded]=useState(testing&&initial?.state==='ended');
  const playingRef=useRef(false),lastSaved=useRef(0),restored=useRef(false),mounted=useRef(true);
  const duration=audio.durationSeconds;
  const checkpoint=(state:CetListeningPlayback["state"])=>{callbacks.current.onCheckpoint(element.current?.currentTime||0,state);};
  useImperativeHandle(controller,()=>({checkpoint:()=>{
    const node=element.current;
    if(node&&loaded&&!stopped)checkpoint(node.ended?'ended':playingRef.current?'playing':testing?'interrupted':'paused');
  }}));
  const setPlaying=(value:boolean)=>{playingRef.current=value;setRunning(value);callbacks.current.onRunningChange(value);};
  useEffect(()=>{
    const node=element.current; mounted.current=true;
    const onHide=()=>{if(node?.currentSrc&&!stopped)callbacks.current.onCheckpoint(node.currentTime,node.ended?'ended':testing?'interrupted':'paused');};
    window.addEventListener('pagehide',onHide);
    return ()=>{
      window.removeEventListener('pagehide',onHide);
      mounted.current=false;
      if(node && playingRef.current){callbacks.current.onCheckpoint(node.currentTime,testing?'interrupted':'paused');node.pause();}
      callbacks.current.onRunningChange(false);
    };
  // Each player is scoped by the parent key to one activity/section.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{if(stopped||blocked){element.current?.pause();playingRef.current=false;setRunning(false);setLoading(false);callbacks.current.onRunningChange(false);}},[stopped,blocked]);
  const play=async()=>{
    const node=element.current;if(!node||blocked||loading||testing&&ended)return;
    setMessage('');setLoading(true);
    if(!loaded){node.src=audio.url;setLoaded(true);node.load();}
    if(node.ended&&!testing){node.currentTime=0;setEnded(false);}
    try{await node.play();if(!mounted.current)node.pause();}
    catch{if(mounted.current){setLoading(false);setPlaying(false);setMessage('音频暂未能播放，请检查连接后重试。');if(testing&&restored.current)checkpoint('interrupted');}}
  };
  return <section className="cet-listening-player" aria-label="听力音频">
    <audio ref={element} preload="none" onLoadedMetadata={()=>{
      const node=element.current;if(!node||restored.current)return;
      if(!stopped&&initial?.position&&initial.position<duration)node.currentTime=initial.position;
      if(testing&&initial?.state==='playing')checkpoint('interrupted');restored.current=true;
    }} onPlaying={()=>{setLoading(false);setMessage('');setPlaying(true);checkpoint('playing');}}
    onPause={()=>{if(!mounted.current)return;setLoading(false);setPlaying(false);if(!stopped&&!element.current?.ended){checkpoint(testing?'interrupted':'paused');if(testing)setMessage('播放被设备中断，请从记录位置继续。');}}}
    onWaiting={()=>{setLoading(true);setMessage('音频正在缓冲，连接恢复后会继续播放。');}}
    onError={()=>{setLoading(false);setPlaying(false);setMessage('音频暂未能加载，请检查连接后重试。');if(restored.current)checkpoint(testing?'interrupted':'paused');}}
    onEnded={()=>{lastSaved.current=Date.now();setPlaying(false);setLoading(false);setEnded(true);setPosition(duration);checkpoint('ended');}}
    onTimeUpdate={()=>{const node=element.current;if(!node)return;setPosition(node.currentTime);if(Date.now()-lastSaved.current>=15000){lastSaved.current=Date.now();checkpoint(node.ended?'ended':node.paused?'paused':'playing');}}} />
    <div className="cet-audio-controls">
      <button type="button" className="cet-audio-play" disabled={blocked||loading||testing&&(ended||running)} aria-label={testing&&ended?'听力播放完毕':loading?'正在加载音频':running?testing?'听力正在播放':'暂停听力':position>0?'继续播放听力':'播放听力'} onClick={()=>{
        if(running&&!testing)element.current?.pause();else if(!running)void play();
      }}>{loading?'加载中…':testing&&ended?'播放完毕':running?testing?'正在播放':'Ⅱ 暂停':position>0?'▶ 继续播放':'▶ 播放听力'}</button>
      <span className="cet-audio-time" aria-live="off">{time(position)} / {time(duration)}</span>
      {testing?<div className="cet-audio-progress" role="progressbar" aria-label="听力播放进度" aria-valuemin={0} aria-valuemax={Math.ceil(duration)} aria-valuenow={Math.floor(position)}><span style={{width:`${Math.min(100,position/duration*100)}%`}} /></div>
        :<input type="range" aria-label="听力播放位置" min={0} max={Math.floor(duration)} step={1} value={Math.floor(position)} disabled={blocked||!loaded} onChange={event=>{const value=Number(event.target.value);if(element.current){element.current.currentTime=value;setPosition(value);setEnded(false);checkpoint(running?'playing':'paused');}}} />}
    </div>
    {testing&&<p>自测音频连续播放，无法暂停或拖动进度。提交后可反复听录音并查看原文。</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
