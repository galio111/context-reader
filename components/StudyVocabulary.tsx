"use client";
import { useMemo, useState } from "react";
import type { StudySnapshot } from "@/types/study";
import type { VocabularyEntry } from "@/types/vocabulary";
import { recallProbability } from "@/lib/studyScheduler";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

export function StudyVocabulary({snapshot,onOpen}:{snapshot:StudySnapshot;onOpen:(entry:VocabularyEntry)=>void}){
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("all");
  const [hidden,setHidden]=useState({en:false,zh:false});
  const [revealed,setRevealed]=useState(new Set<string>());
  const states=useMemo(()=>new Map(snapshot.cards.map(c=>[c.entry_id,c.memory.state===0?"new":c.memory.state===2&&c.memory.stability>=21&&(recallProbability(c.memory,new Date(snapshot.serverNow))??0)>=.9?"steady":"learning"])),[snapshot]);
  const entries=snapshot.entries.filter(e=>(filter==="all"||filter==="studied"&&states.get(e.id)!=="new"||states.get(e.id)===filter)&&(e.word+" "+e.basicMeaning+" "+e.contextMeaning).toLowerCase().includes(query.toLowerCase()));
  function toggle(lang:"en"|"zh"){setHidden({...hidden,[lang]:!hidden[lang]});setRevealed(new Set([...revealed].filter(k=>!k.endsWith(":"+lang))));}
  function cell(entry:VocabularyEntry,lang:"en"|"zh"){
    const key=entry.id+":"+lang,concealed=hidden[lang]&&!revealed.has(key);
    return <button className={concealed?styles.concealed:styles.wordCell} aria-label={concealed?`显示${lang==="en"?"英文":"中文"}`:undefined} onClick={()=>concealed?setRevealed(new Set([...revealed,key])):onOpen(entry)}>{concealed?<span aria-hidden="true">••••••</span>:lang==="en"?<strong lang="en">{entry.word}</strong>:<span>{entry.contextMeaning||entry.basicMeaning}</span>}</button>;
  }
  return <section className={styles.surface}>
    <div className={styles.sectionHead}><span>{entries.length} 个词</span><label className={styles.search}><StudyIcon name="search"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索生词" aria-label="搜索生词"/></label></div>
    <div className={styles.wordFilters} aria-label="单词筛选">{[["all","全部"],["studied","已学"],["steady","熟悉"],["learning","待巩固"],["new","未学"]].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <div className={styles.wordColumns}><button aria-pressed={hidden.en} onClick={()=>toggle("en")}>{hidden.en?"显示英文":"隐藏英文"}</button><button aria-pressed={hidden.zh} onClick={()=>toggle("zh")}>{hidden.zh?"显示中文":"隐藏中文"}</button><span/></div>
    <ul className={styles.vocabularyRows}>{entries.map(e=><li key={e.id}>{cell(e,"en")}{cell(e,"zh")}<button className={styles.iconButton} aria-label={`查看 ${e.word} 详情`} onClick={()=>onOpen(e)}><StudyIcon name="arrow"/></button></li>)}</ul>
    {!entries.length&&<p className={styles.caption}>{query?"没有找到这个词":"暂无单词"}</p>}
  </section>;
}
