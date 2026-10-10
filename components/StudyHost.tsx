"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { OPEN_STUDY_EVENT, STUDY_SOURCE_RESULT_EVENT, STUDY_VIEW_EVENT } from "@/lib/studyNavigation";
import { getVocabularyEntries } from "@/lib/vocabulary";
import styles from "./StudyPanel.module.css";
import { StudyIcon } from "./StudyIcon";
const StudyPanel = dynamic(() => import("./StudyPanel").then(m => m.StudyPanel), { ssr:false });
export function StudyHost() {
  const { account, loading, isOffline, requireAccount } = useAccount();
  const [open,setOpen] = useState(false), [source,setSource] = useState(false), [remind,setRemind] = useState(false);
  const [notice,setNotice] = useState("");
  const owner = account.profile?.userId ?? "";
  const launch = useCallback(() => {
    if (!requireAccount("登录后即可保存复习进度。")) return;
    setRemind(false); setSource(false); setNotice(""); setOpen(true);
  },[requireAccount]);
  useEffect(() => {
    const fn=()=>launch(); window.addEventListener(OPEN_STUDY_EVENT,fn);
    return ()=>window.removeEventListener(OPEN_STUDY_EVENT,fn);
  },[launch]);
  useEffect(() => {
    setOpen(false); setSource(false); setRemind(false);
  },[owner]);
  useEffect(() => {
    if (loading) return;
    const q=new URLSearchParams(location.search);
    if (q.get("study")==="1") { launch(); q.delete("study"); history.replaceState(history.state,"",location.pathname+(q.size?"?"+q.toString():"")); }
  },[loading,launch]);
  useEffect(() => {
    const fn=(e:Event)=> {
      const ok=(e as CustomEvent<boolean>).detail;
      if (!ok) { setSource(false); setOpen(true); setNotice("没有找到原文，可以继续复习。"); }
    };
    window.addEventListener(STUDY_SOURCE_RESULT_EVENT,fn);
    return ()=>window.removeEventListener(STUDY_SOURCE_RESULT_EVENT,fn);
  },[]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(STUDY_VIEW_EVENT,{detail:open&&!source}));
  },[open,source]);
  useEffect(() => {
    if (!owner || isOffline || location.pathname!=="/") return;
    let cancelled=false;
    const timer=setTimeout(async()=>{
      const key="context-reader-study-reminder:"+owner+":"+new Date(Date.now()+8*3600000).toISOString().slice(0,10);
      try {
        if (sessionStorage.getItem(key)) return;
        if (!getVocabularyEntries().length) return;
        const r=await fetch("/api/study",{headers:{"X-Context-Account":owner}});
        if (!r.ok) return;
        const data=await r.json();
        if (cancelled || !data.settings.reminders || (data.settings.pausedUntil && Date.parse(data.settings.pausedUntil)>Date.now()) || data.today?.completed_at) return;
        sessionStorage.setItem(key,"1"); setRemind(true);
      } catch { /* A reminder never interrupts reading on network failure. */ }
    },4500);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[owner,isOffline]);
  return <>
    {remind&&!open&&<aside className={styles.notice} aria-label="今日复习提醒"><div><strong>生词，今天也记一点</strong><p>完成复习，再继续阅读。</p></div><button onClick={launch}>去背词</button><button aria-label="稍后复习" onClick={()=>setRemind(false)}><StudyIcon name="close"/></button></aside>}
    {open&&<StudyPanel key={owner} visible={!source} notice={notice} onClose={()=>{setOpen(false);setSource(false);}} onSource={()=>{setNotice("");setSource(true);}} />}
    {source&&<button type="button" className={styles.returnToStudy} onClick={()=>setSource(false)}><StudyIcon name="back"/>继续背词</button>}
  </>;
}
