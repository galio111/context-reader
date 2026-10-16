"use client";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { StudySnapshot } from "@/types/study";
import type { VocabularyEntry } from "@/types/vocabulary";
import { studyWordState } from "@/lib/studyPresentation";
import { matchesStudyVocabulary } from "@/lib/studyVocabularySearch";
import { orderStudyVocabulary, shuffleStudyVocabularyIds, type StudyVocabularyOrder } from "@/lib/studyVocabularyOrder";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

const VocabularyRow=memo(function VocabularyRow({entry,hiddenEn,hiddenZh,revealedEn,revealedZh,onReveal,onOpen}:{entry:VocabularyEntry;hiddenEn:boolean;hiddenZh:boolean;revealedEn:boolean;revealedZh:boolean;onReveal:(key:string)=>void;onOpen:(entry:VocabularyEntry)=>void}){
  function cell(lang:"en"|"zh",hidden:boolean,revealed:boolean){
    const content=lang==="en"?<strong lang="en">{entry.word}</strong>:<span>{entry.contextMeaning||entry.basicMeaning}</span>;
    if(!hidden)return <div className={styles.wordCell}>{content}</div>;
    return <button className={revealed?styles.wordCell:styles.concealed} aria-label={`${revealed?"隐藏":"显示"}${lang==="en"?"英文":"中文"}`} aria-pressed={revealed} onClick={()=>onReveal(entry.id+":"+lang)}>{revealed?content:<span aria-hidden="true">••••••</span>}</button>;
  }
  return <>{cell("en",hiddenEn,revealedEn)}{cell("zh",hiddenZh,revealedZh)}<button className={styles.iconButton} aria-label={`查看 ${entry.word} 详情`} onClick={()=>onOpen(entry)}><StudyIcon name="arrow"/></button></>;
});

export const StudyVocabulary=memo(function StudyVocabulary({snapshot,onOpen}:{snapshot:StudySnapshot;onOpen:(entry:VocabularyEntry)=>void}){
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("all");
  const [hidden,setHidden]=useState({en:false,zh:false});
  const [revealed,setRevealed]=useState(new Set<string>());
  const reveal=useCallback((key:string)=>setRevealed(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;}),[]);
  const [order,setOrder]=useState<StudyVocabularyOrder>("collected"),[shuffledIds,setShuffledIds]=useState<string[]>([]);
  const states=useMemo(()=>new Map(snapshot.cards.map(c=>[c.entry_id,studyWordState(c,new Date(snapshot.serverNow))])),[snapshot]);
  const ordered=useMemo(()=>orderStudyVocabulary(snapshot.entries,order,shuffledIds),[snapshot.entries,order,shuffledIds]);
  const entries=useMemo(()=>ordered.filter(e=>(filter==="all"||filter==="studied"&&["review","steady"].includes(states.get(e.id)??"")||states.get(e.id)===filter)&&matchesStudyVocabulary(e,query)),[ordered,filter,states,query]);
  const listRef=useRef<HTMLUListElement>(null), headRef=useRef<HTMLDivElement>(null);
  const [scrollMargin,setScrollMargin]=useState(0);
  const virtual=entries.length>100;
  const getItemKey=useCallback((index:number)=>entries[index].id,[entries]);
  const rows=useVirtualizer({count:virtual?entries.length:0,getScrollElement:()=>listRef.current?.closest("dialog")??null,getItemKey,estimateSize:()=>76,overscan:8,scrollMargin,useAnimationFrameWithResizeObserver:true});
  useLayoutEffect(()=>{
    const list=listRef.current,scroll=list?.closest("dialog");
    if(!list||!scroll||!virtual)return;
    const update=()=>setScrollMargin(list.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop);
    update();const observer=new ResizeObserver(update);
    observer.observe(scroll);if(headRef.current)observer.observe(headRef.current);
    const page=list.closest("main");if(page)observer.observe(page);
    return()=>observer.disconnect();
  },[virtual]);
  function changeOrder(next:StudyVocabularyOrder){
    if(next==="random"){
      // Shuffle the currently visible subset too, so a filtered list always
      // changes on each click. Keep the other rows for stable search/clear.
      const visibleIds=entries.map(e=>e.id), visibleSet=new Set(visibleIds);
      const otherIds=ordered.filter(e=>!visibleSet.has(e.id)).map(e=>e.id);
      setShuffledIds([...shuffleStudyVocabularyIds(visibleIds),...shuffleStudyVocabularyIds(otherIds)]);
    }
    setOrder(next);
  }
  function toggle(lang:"en"|"zh"){setHidden({...hidden,[lang]:!hidden[lang]});setRevealed(new Set([...revealed].filter(k=>!k.endsWith(":"+lang))));}
  return <section className={styles.surface}>
    <div ref={headRef} className={`${styles.sectionHead} ${styles.vocabularyHead}`}><span>{entries.length} 个词</span><div className={styles.vocabularyTools}>
      <div className={styles.wordOrder} role="group" aria-label="生词排序" data-ui-target="study.vocabulary-order">{([["collected","收藏顺序"],["alphabetical","字母 A–Z"],["random","随机"]] as const).map(([key,label])=><button type="button" key={key} aria-pressed={order===key} title={key==="collected"?"按收藏时间，最新在前":key==="random"?"每次点击重新打乱":"按英文从 A 到 Z"} onClick={()=>changeOrder(key)}>{label}</button>)}</div>
      <label className={styles.search}><StudyIcon name="search"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入词头或中文释义" aria-label="搜索生词"/></label>
    </div></div>
    <div className={styles.wordFilters} aria-label="单词筛选">{[["all","全部"],["studied","已学"],["learning","正在背"],["steady","熟悉"],["review","待巩固"],["new","未学"]].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <div className={styles.wordColumns}><button aria-pressed={hidden.en} onClick={()=>toggle("en")}>{hidden.en?"显示英文":"隐藏英文"}</button><button aria-pressed={hidden.zh} onClick={()=>toggle("zh")}>{hidden.zh?"显示中文":"隐藏中文"}</button><span/></div>
    <ul ref={listRef} className={styles.vocabularyRows} style={virtual?{height:rows.getTotalSize(),position:"relative"}:undefined}>
      {(virtual?rows.getVirtualItems():entries.map((e,index)=>({key:e.id,index,start:0}))).map(row=>{const e=entries[row.index];return <li key={e.id} ref={virtual?rows.measureElement:undefined} data-index={row.index} aria-posinset={row.index+1} aria-setsize={entries.length} style={virtual?{position:"absolute",top:0,left:0,width:"100%",transform:`translateY(${row.start-scrollMargin}px)`}:undefined}><VocabularyRow entry={e} hiddenEn={hidden.en} hiddenZh={hidden.zh} revealedEn={revealed.has(e.id+":en")} revealedZh={revealed.has(e.id+":zh")} onReveal={reveal} onOpen={onOpen}/></li>;})}
    </ul>
    {!entries.length&&<p className={styles.caption}>{query?"没有找到这个词":"暂无单词"}</p>}
  </section>;
});
