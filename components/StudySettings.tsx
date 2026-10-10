"use client";
import { useEffect, useRef, useState } from "react";
import type { StudySettings as Settings, StudySnapshot } from "@/types/study";
import "./cet/cet.css";
import { CetSelect } from "./cet/CetSelect";
import styles from "./StudyPanel.module.css";

export function StudySettings({value, save, onSaved, order, motion, onDisplay, paused, onPause, onProfile}: {
  value:Settings;save:(settings:Settings)=>Promise<StudySnapshot>;onSaved:(snapshot:StudySnapshot)=>void;
  order:"ordered"|"random";motion:boolean;onDisplay:(order:"ordered"|"random",motion:boolean)=>void;
  paused:boolean;onPause:()=>void;onProfile:()=>void;
}) {
  const [draft,setDraft]=useState(value),[status,setStatus]=useState("");
  const pending=useRef<Settings|null>(null),saving=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const callbacks=useRef({save,onSaved});callbacks.current={save,onSaved};
  const flush=useRef<()=>Promise<void>>(async()=>{});
  flush.current=async()=>{
    if(saving.current||!pending.current)return;
    saving.current=true;setStatus("保存中");
    while(pending.current){
      const next=pending.current;pending.current=null;
      try { const snapshot=await callbacks.current.save(next);callbacks.current.onSaved(snapshot); }
      catch { pending.current ??=next;setStatus("未保存");saving.current=false;return; }
    }
    saving.current=false;setStatus("");
  };
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);void flush.current();},[]);
  function change(patch:Partial<Settings>){
    const next={...draft,...patch};setDraft(next);pending.current=next;
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>void flush.current(),450);
  }
  function number(key:"reviewsPerDay"|"forgotMinutes"|"unsureMinutes",label:string,max:number,unit:string){return <div className={styles.settingRow}><label htmlFor={"study-"+key}>{label}</label><div className={styles.fieldUnit}><input id={"study-"+key} aria-label={label} type="number" min="1" max={max} defaultValue={draft[key]} onBlur={e=>{const n=Math.max(1,Math.min(max,Math.round(Number(e.target.value)||value[key]||1)));e.target.value=String(n);if(n!==draft[key])change({[key]:n});}} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/><span>{unit}</span></div></div>;}
  return <section className={styles.surface}>
    {number("reviewsPerDay","每日最多复习",300,"词")}
    <div className={styles.settingRow}><div><span>目标记住率</span><p>越高，复习越频繁</p></div><CetSelect label="目标记住率" value={String(draft.retention)} options={[.85,.9,.95].map(n=>({key:String(n),text:Math.round(n*100)+"%"}))} onChange={n=>change({retention:Number(n)})}/></div>
    {number("forgotMinutes","不记得后，再次出现",120,"分钟")}
    {number("unsureMinutes","模糊但正确，再次出现",120,"分钟")}
    <div className={styles.settingRow}><span>出词顺序</span><div className={styles.segmented}><button aria-pressed={order==="ordered"} onClick={()=>onDisplay("ordered",motion)}>顺序</button><button aria-pressed={order==="random"} onClick={()=>onDisplay("random",motion)}>乱序</button></div></div>
    <div className={styles.settingRow}><span>切词动效</span><div className={styles.segmented}><button aria-pressed={motion} onClick={()=>onDisplay(order,true)}>轻柔</button><button aria-pressed={!motion} onClick={()=>onDisplay(order,false)}>关闭</button></div></div>
    <div className={styles.settingRow}><label htmlFor="study-remind">打开网站时提醒</label><input id="study-remind" className={styles.switch} type="checkbox" checked={draft.reminders} onChange={e=>change({reminders:e.target.checked})}/></div>
    <div className={styles.settingRow}><span>阅读画像</span><button onClick={onProfile}>查看</button></div>
    <div className={styles.settingRow}><span>{paused?"学习已暂停":"暂停学习"}</span><button onClick={onPause}>{paused?"恢复":"暂停"}</button></div>
    {status&&<div className={styles.saveStatus} role="status">{status}{status==="未保存"&&<button onClick={()=>void flush.current()}>重试</button>}</div>}
  </section>;
}
