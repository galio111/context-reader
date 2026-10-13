"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";
import { useDocumentScrollLock } from "./useDocumentScrollLock";
import { useStudyTimer } from "./useStudyTimer";
import { useStudyReviewQueue } from "./useStudyReviewQueue";
import { StudyRewards } from "./StudyRewards";
import { StudyIcon, type StudyIconName } from "./StudyIcon";
import { StudyDialog } from "./StudyDialog";
import { StudyWord } from "./StudyWord";
import { StudyDictionaryHint } from "./StudyDictionaryHint";
import { BookDictionary } from "./BookDictionary";
import { DictionaryWindow } from "./DictionaryWindow";
import { useStudyEntry, preloadStudyEntry } from "./useStudyEntry";
import { hydrateStudyResponse } from "@/lib/studyTransport";
import { useStudyVocabularyEntries } from "./useStudyVocabularyEntries";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_DATA_MERGED_EVENT, accountDataEventKinds } from "@/lib/accountEvents";
import { addVocabularyEntry, getVocabularyEntries, vocabularyIdentity } from "@/lib/vocabulary";
import { createStandaloneVocabularyEntry } from "@/lib/standaloneDictionary";
import { flushLearningStorage } from "@/lib/learningStorage";
import { StudySettings as StudySettingsView } from "./StudySettings";
import { StudyVocabulary } from "./StudyVocabulary";
import { StudyStats } from "./StudyStats";
import { LoadingStatus } from "./LoadingStatus";
import { CetSelect } from "./cet/CetSelect";
import { activeStudySnapshot, chooseStudyCard, remainingStudyCounts } from "@/lib/studyPresentation";
import type { VocabularyEntry } from "@/types/vocabulary";
import { openStudySource } from "@/lib/studyNavigation";
import { planProgress, shanghaiDay, studyPaused } from "@/lib/studyScheduler";
import type { StudyAnswer, StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";
import { readRecommendationPreferences, writeRecommendationPreferences, type RecommendationReadingLevel } from "@/lib/recommendationPreferences";

type Tab = "today" | "vocabulary" | "data" | "rewards" | "settings" | "profile";
const navigation: Array<[Tab,string,StudyIconName]> = [["today","背单词","cards"],["vocabulary","生词本","book"],["data","学习数据","chart"],["rewards","学习奖励","gift"],["settings","设置","settings"]];
export function StudyPanel({visible,onClose,onSource,notice,requestedTab="today",requestKey=0}:{visible:boolean;onClose:()=>void;onSource:()=>void;notice:string;requestedTab?:"today"|"profile";requestKey?:number}) {
  const {account,isOffline,syncNow,refreshAccount}=useAccount();
  const owner=account.profile?.userId ?? "";
  const [snapshot,setSnapshot]=useState<StudySnapshot|null>(null);
  const [tab,setTab]=useState<Tab>("today");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(notice);
  const [intent,setIntent]=useState<"forgot"|"unsure"|"remembered"|null>(null);
  const [assisted,setAssisted]=useState(false);
  const [token,setToken]=useState("");
  const [presentation,setPresentation]=useState(0);
  const [tick,setTick]=useState(Date.now());
  const [hint,setHint]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{const f=(e:Event)=>setMenuOpen(Boolean((e as CustomEvent).detail));window.addEventListener("context-reader-main-menu-state",f);return()=>window.removeEventListener("context-reader-main-menu-state",f);},[]);
  const [pauseDays,setPauseDays]=useState(3),[pauseConfirm,setPauseConfirm]=useState(false);
  const [order,setOrder]=useState<"ordered"|"random">("ordered"),[motion,setMotion]=useState(true);
  const [confirm,setConfirm]=useState<"profile"|number|null>(null);
  const [wordDetailId,setWordDetailId]=useState<string|null>(null);
  const openVocabularyEntry=useCallback((entry:VocabularyEntry)=>setWordDetailId(entry.id),[]);
  const [relatedQuery,setRelatedQuery]=useState<string|null>(null);
  const [relatedEntries,setRelatedEntries]=useState<VocabularyEntry[]>([]);
  useEffect(()=>{if(!visible)setRelatedQuery(null);},[visible]);
  const openRelatedLookup=(query:string)=>{setRelatedEntries(getVocabularyEntries());setRelatedQuery(query);};
  const liveEntries=useStudyVocabularyEntries(snapshot?.entries,owner);
  const wordDetail=liveEntries.find(entry=>entry.id===wordDetailId)??null;
  const {entry:completeWordDetail}=useStudyEntry(wordDetail??undefined);
  const [rewardNotice,setRewardNotice]=useState(false);
  const priorClaims=useRef(new Map<string,number>());
  const randomRanks=useRef(new Map<string,number>());
  const answerBody=useRef<HTMLDivElement>(null);
  const questionSurface=useRef<HTMLElement>(null);
  const [profile,setProfile]=useState<{activeSeconds:number;uniqueLookups:number;result?:{summary:string;recommendedLevel:string;strengths:string[];focus:string[]};eligible:boolean}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const alive=useRef(true);
  const displayed=useRef("");
  const profileAction=useRef("");
  const preparedDay=useRef("");
  const offset=useRef(0),requestLock=useRef(false);
  const acceptedAt=useRef(0);
  const snapshotRef=useRef<StudySnapshot|null>(null);
  const lastLoadedAt=useRef(0), mutationEpoch=useRef(0), mutations=useRef(0);
  const refreshRequested=useRef(true), refreshInFlight=useRef(false);
  const presentationRetry=useRef(false), retriedCard=useRef("");
  const [refreshTick,setRefreshTick]=useState(0);
  const requestRefresh=useCallback(()=>{refreshRequested.current=true;setRefreshTick(n=>n+1);},[]);
  useDocumentScrollLock(visible);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const accept=useCallback((s:StudySnapshot)=>{
    if(!alive.current||Date.parse(s.serverNow)<acceptedAt.current)return;
    const firstSnapshot=!snapshotRef.current;
    acceptedAt.current=Date.parse(s.serverNow);
    // Any newer accepted state, including a foreground read/retry, supersedes
    // background requests that started before it.
    mutationEpoch.current++;
    for(const claim of s.claims??[]){
      const pending=claim.points-claim.claimed_points+(claim.plan&&!claim.claimed_at?1:0);
      if(pending>(priorClaims.current.get(claim.id)??0))setRewardNotice(true);
      priorClaims.current.set(claim.id,pending);
    }
    snapshotRef.current=s;lastLoadedAt.current=Date.now();
    offset.current=Date.parse(s.serverNow)-Date.now();setSnapshot(s);setTick(Date.now());
    // A restored outbox can return a complete snapshot before the initial start.
    if(firstSnapshot&&!requestLock.current)setBusy(false);
    if(presentationRetry.current){presentationRetry.current=false;setPresentation(n=>n+1);}
  },[]);
  const acceptSettings=useCallback((s:StudySnapshot)=>{
    if(!alive.current)return;
    const current=snapshotRef.current;
    if(!current){accept(s);return;}
    mutationEpoch.current++;
    const next={...current,settings:s.settings};
    snapshotRef.current=next;setSnapshot(next);
    // A settings-only merge neither rewinds the server clock nor makes the
    // retained cards newer, and cannot fulfill a pending presentation refresh.
  },[accept]);
  const api=useCallback(async <T,>(body?:unknown):Promise<T>=>{
    const op=(body as {op?:string}|undefined)?.op;
    const mutating=Boolean(op&&op!=="start"&&op!=="prepare"&&op!=="present");
    if(mutating){mutationEpoch.current++;mutations.current++;}
    try {
    const response=await fetch("/api/study",{method:body?"POST":"GET",headers:{"Content-Type":"application/json","X-Context-Account":owner,"X-Study-Format":"compact-v1"},body:body?JSON.stringify(body):undefined,cache:"no-store",signal:body&&(body as {op?:string}).op==="review"?AbortSignal.timeout(20000):undefined});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||"暂时无法保存，请稍后重试。"),{code:data.code,status:response.status});
    return hydrateStudyResponse(data) as T;
    } finally {
      if(mutating){mutationEpoch.current++;mutations.current--;if(alive.current)setRefreshTick(n=>n+1);}
    }
  },[owner]);
  const reviews=useStudyReviewQueue(owner,api,accept);
  const pending=reviews.pending.length>0;
  const run=async(fn:()=>Promise<void>)=>{
    if(requestLock.current)return;
    requestLock.current=true;setBusy(true);setError("");
    try{await fn();}catch(e){if(alive.current)setError(e instanceof TypeError?"网络未连接。请恢复连接后重试，当前答案仍然保留。":(e as Error).message);}
    finally{requestLock.current=false;if(alive.current)setBusy(false);}
  };
  useEffect(()=>{
    // Account bootstrap can include megabytes of unrelated reading/cache data.
    // It must not hold the study controls after the server's first snapshot arrives.
    void syncNow({dirtyKinds:["vocabulary"]}).then(synced=>{
      if(alive.current&&(synced.pushedCount>0||synced.pulledCount>0))requestRefresh();
    }).catch(()=>{});
    try{const local=JSON.parse(localStorage.getItem("context-reader-study-display:"+owner)||"{}");setOrder(local.order==="random"?"random":"ordered");setMotion(local.motion!==false);}catch{}
    try{profileAction.current=sessionStorage.getItem("context-reader-profile-action:"+owner)||"";}catch{}
  // A single account-scoped load; a sync callback changing must not reset a card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner]);
  useEffect(()=>{
    const merged=(event:Event)=>{const kinds=accountDataEventKinds(event);if(!kinds.length||kinds.includes("vocabulary"))requestRefresh();};
    let timer:ReturnType<typeof setTimeout>|undefined, syncing=false, dirty=false, cancelled=false;
    const flush=async()=>{
      if(syncing||cancelled)return;
      dirty=false;syncing=true;
      try{await syncNow({dirtyKinds:["vocabulary"]});if(!cancelled)requestRefresh();}catch{/* Account sync owns retry and offline state. */}
      finally{syncing=false;if(dirty&&!cancelled)timer=setTimeout(()=>void flush(),300);}
    };
    const changed=(event:Event)=>{
      const kinds=accountDataEventKinds(event);if(kinds.length&&!kinds.includes("vocabulary"))return;
      dirty=true;clearTimeout(timer);timer=setTimeout(()=>void flush(),300);
    };
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT,merged);
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT,changed);
    return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT,merged);window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT,changed);};
  },[requestRefresh,syncNow]);
  useEffect(()=>{
    if(!refreshRequested.current||refreshInFlight.current||requestLock.current||busy)return;
    const initial=!snapshotRef.current;
    // Pending outbox rows hide their cards. They can drain while the first
    // snapshot loads; only later refreshes must wait for their confirmation.
    if(!initial&&(mutations.current||reviews.pendingRef.current.length))return;
    refreshRequested.current=false;refreshInFlight.current=true;
    const epoch=mutationEpoch.current;
    if(initial)setBusy(true);
    void api<StudySnapshot>({op:"start"}).then(s=>{
      if(!alive.current)return;
      if(snapshotRef.current&&(epoch!==mutationEpoch.current||mutations.current||reviews.pendingRef.current.length)){refreshRequested.current=true;return;}
      accept(s);
    }).catch(e=>{
      if(alive.current&&epoch===mutationEpoch.current)setError(e instanceof TypeError?"网络未连接。请恢复连接后重试，学习进度仍然保留。":e.message);
    }).finally(()=>{
      refreshInFlight.current=false;
      if(alive.current){if(initial&&!requestLock.current)setBusy(false);setRefreshTick(n=>n+1);}
    });
  },[refreshTick,busy,pending,api,accept]);
  const previouslyVisible=useRef(false);
  useEffect(()=>{
    if(visible&&!previouslyVisible.current&&snapshotRef.current&&Date.now()-lastLoadedAt.current>30000)requestRefresh();
    previouslyVisible.current=visible;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[visible,requestRefresh]);
  useEffect(()=>{if(notice)setMessage(notice);},[notice]);
  useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(""),5000);return()=>clearTimeout(id);},[message]);
  useEffect(()=>{
    const el=dialog.current;if(!el)return;
    if(visible&&!el.open)el.showModal();else if(!visible&&el.open)el.close();
  },[visible]);
  useEffect(()=>{if(!visible)return;setTick(Date.now());const id=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(id);},[visible]);
  const now=new Date(tick+offset.current);
  const learningSnapshot=useMemo(()=>snapshot?activeStudySnapshot({...snapshot,entries:liveEntries}):null,[snapshot,liveEntries]);
  const progress=useMemo(()=>planProgress(learningSnapshot?.cards??[],snapshot?.today?.card_ids??[],new Date(tick+offset.current),snapshot?.today?.new_ids),[snapshot,learningSnapshot,tick]);
  const queuedIds=useMemo(()=>new Set(reviews.pending.map(item=>item.cardId)),[reviews.pending]);
  const queueProgress=useMemo(()=>planProgress((learningSnapshot?.cards??[]).filter(card=>!queuedIds.has(card.id)),snapshot?.today?.card_ids??[],new Date(tick+offset.current),snapshot?.today?.new_ids),[snapshot,learningSnapshot,tick,queuedIds]);
  for(const ready of queueProgress.ready)if(!randomRanks.current.has(ready.id))randomRanks.current.set(ready.id,Math.random());
  const card=chooseStudyCard(queueProgress.ready,displayed.current,order,randomRanks.current);
  useEffect(()=>{displayed.current=card?.id??"";},[card?.id]);
  const entrySummary=liveEntries.find(e=>e.id===card?.entry_id);
  const {entry,error:entryError,missing:entryMissing,retry:retryEntry}=useStudyEntry(entrySummary);
  useEffect(()=>{if(entryMissing)requestRefresh();},[entryMissing,requestRefresh]);
  useEffect(()=>{
    if(!visible||isOffline)return;
    // Keep the next two prompts ready without downloading the entire notebook.
    const nextIds=new Set(queueProgress.ready.filter(c=>c.id!==card?.id).slice(0,2).map(c=>c.entry_id));
    for(const item of liveEntries)if(nextIds.has(item.id))void preloadStudyEntry(owner,item).catch(()=>{});
  },[visible,isOffline,owner,card?.id,queueProgress.ready,liveEntries]);
  const cardKey=card?card.id+":"+card.version:"";
  useEffect(()=>{if(visible&&tab==="today"&&cardKey)questionSurface.current?.focus({preventScroll:true});},[visible,tab,cardKey]);
  useEffect(()=>{setIntent(null);setHint(false);setAssisted(false);answerBody.current?.scrollTo(0,0);},[cardKey]);
  const activeMs=useStudyTimer(visible&&tab==="today"&&Boolean(card)&&Boolean(entry)&&Boolean(token)&&!busy&&!pending&&!pauseConfirm&&confirm===null&&!wordDetail&&!relatedQuery&&!rewardNotice&&!menuOpen,cardKey,owner);
  useEffect(()=>{
    setToken("");
    if(!visible||!card||!reviews.ready||reviews.pendingRef.current.length)return;
    let cancelled=false;
    void api<{token:string}>({op:"present",cardId:card.id,version:card.version}).then(r=>{if(!cancelled){setToken(r.token);retriedCard.current="";}}).catch(e=>{
      if(cancelled)return;
      // A different device may have advanced the retained card. Refresh once;
      // never authorize an answer with its old version or presentation token.
      if((e.status===409||e.code==="state_changed")&&retriedCard.current!==cardKey){retriedCard.current=cardKey;presentationRetry.current=true;requestRefresh();}
      else setError((e as Error).message);
    });
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cardKey,api,presentation,visible,pending,reviews.ready]);
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{
      if(menuOpen||!visible||tab!=="today"||!card||!entry||confirm!==null||pauseConfirm||wordDetail||relatedQuery||rewardNotice||["INPUT","SELECT","TEXTAREA"].includes((e.target as HTMLElement)?.tagName))return;
      if(e.repeat||e.altKey||e.ctrlKey||e.metaKey||(e.target as HTMLElement)?.isContentEditable)return;
      if(!intent&&e.code==="Space"&&(!entry?.sourceSentence.trim()||(card.mode!=="basic_cn_to_en"&&card.mode!=="basic_cn_to_en_dictionary"))&&!(e.target as HTMLElement)?.closest("button,a,[role=button]")){e.preventDefault();setHint(value=>!value);return;}
      if(busy)return;
      if(!intent&&["1","2","3"].includes(e.key)){e.preventDefault();setIntent(e.key==="1"?"forgot":e.key==="2"?"unsure":"remembered");}
    };
    window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);
  },[visible,tab,busy,card,entry,pending,intent,confirm,pauseConfirm,wordDetail,relatedQuery,rewardNotice,menuOpen]);
  const submit=(answer:StudyAnswer)=>{
    if(!card||!token||reviews.pendingRef.current.some(item=>item.cardId===card.id))return;
    try {
      // Persist first. The next prompt can render while the server records this answer.
      if(reviews.enqueue({op:"review",id:crypto.randomUUID(),cardId:card.id,version:card.version,token,answer,activeMs:activeMs(),queuedAt:Date.now()})){setToken("");setError("");}
    } catch(e) { setError((e as Error).message); }
  };
  const refresh=async()=>{
    let fresh=await api<StudySnapshot>();
    if(!fresh.today&&!studyPaused(fresh.settings,new Date(fresh.serverNow)))fresh=await api<StudySnapshot>({op:"start"});
    accept(fresh);setPresentation(n=>n+1);
  };
  const currentDay=shanghaiDay(now);
  const learnedToday=snapshot?.daily.find(day=>day.day===currentDay)?.new_cards??0;
  useEffect(()=>{
    if(!snapshot||snapshot.today?.day===currentDay||pending||busy||studyPaused(snapshot.settings,new Date(tick+offset.current))||preparedDay.current===currentDay)return;
    preparedDay.current=currentDay;
    void run(async()=>{accept(await api<StudySnapshot>({op:"start"}));setPresentation(n=>n+1);});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentDay,snapshot?.today?.day,snapshot?.settings.pausedUntil,pending,busy]);
  const loadProfile=()=>run(async()=>{
    const r=await fetch("/api/study/profile",{headers:{"X-Context-Account":owner},cache:"no-store"});
    const d=await r.json();if(!r.ok)throw new Error(d.error);setProfile(d);
  });
  const generateProfile=()=>run(async()=>{
    if(!snapshot)return;
    const key="context-reader-profile-action:"+owner;
    profileAction.current ||= crypto.randomUUID();
    try{sessionStorage.setItem(key,profileAction.current);}catch{}
    const r=await fetch("/api/study/profile",{method:"POST",headers:{"Content-Type":"application/json","X-Context-Account":owner,"x-context-action-id":profileAction.current},body:JSON.stringify({confirmedCost:snapshot.policy.profileCost})});
    const d=await r.json();
    if(!r.ok){if(r.status!==409){profileAction.current="";try{sessionStorage.removeItem(key);}catch{}}throw new Error(d.error);}
    setProfile(d);profileAction.current="";try{sessionStorage.removeItem(key);}catch{}await refreshAccount();
  });
  const profileAutoLoad=useRef(false);
  useEffect(()=>{if(visible){setTab(requestedTab);profileAutoLoad.current=false;}},[requestKey,requestedTab,visible]);
  useEffect(()=>{if(visible&&tab==="profile"&&snapshot&&!busy&&!profileAutoLoad.current){profileAutoLoad.current=true;void loadProfile();}});
  const paused=snapshot?studyPaused(snapshot.settings,now):false;
  const remaining=remainingStudyCounts(learningSnapshot?.cards??[],snapshot?.today?.card_ids??[],now,paused);
  const due=learningSnapshot?.cards.filter(c=>c.memory.state!==0&&Date.parse(c.memory.due)<=now.getTime()).length??0;
  const fresh=learningSnapshot?.cards.filter(c=>c.memory.state===0).length??0;
  const completed=!pending&&progress.total>0&&progress.finished===progress.total;
  const lastReview=snapshot?.reviews.find(r=>!r.undone);
  const undo=()=>run(async()=>{
    if(!lastReview)return;
    const restored=await api<StudySnapshot>({op:"undo",id:lastReview.id});
    displayed.current=lastReview.card_id;accept(restored);setPresentation(n=>n+1);setMessage("已回到上一张");
  });
  const source=(word:VocabularyEntry)=>{
    if(word.id===entry?.id)setAssisted(true);
    setWordDetailId(null);onSource();setTimeout(()=>openStudySource(word),80);
  };
  const updateDisplay=(nextOrder=order,nextMotion=motion)=>{
    setOrder(nextOrder);setMotion(nextMotion);
    try{localStorage.setItem("context-reader-study-display:"+owner,JSON.stringify({order:nextOrder,motion:nextMotion}));}catch{}
  };
  const selectTab=(next:Tab)=>{setTab(next);if(next==="profile")void loadProfile();};
  const retryPrepare=()=>run(async()=>{const s=await api<StudySnapshot>({op:paused?"resume":"start"});accept(!s.today&&!studyPaused(s.settings,new Date(s.serverNow))?await api<StudySnapshot>({op:"start"}):s);});
  const title=tab==="profile"?"阅读画像":navigation.find(([key])=>key===tab)?.[1]??"背单词";
  const undoButton=<button className={styles.iconButton} aria-label="回到上一张" title="回到上一张" disabled={!lastReview||busy||Boolean(pending)} onClick={()=>void undo()}><StudyIcon name="undo"/></button>;
  const busyLabel=busy?"保存中…":!token?"准备中…":"";
  const pendingClaims=(snapshot?.claims??[]).filter(c=>c.points>c.claimed_points||!c.claimed_at);
  const claimRewards=(ids:string[])=>run(async()=>{
    let points=0;
    for(const id of ids){const r=await api<{claimed:{points:number};snapshot:StudySnapshot}>({op:"claimReward",id});points+=r.claimed.points;accept(r.snapshot);}
    await refreshAccount();setRewardNotice(false);setMessage(points>0?points+" 点已到账":"奖励已领取，可在奖励页启用会员");
  });
  return <dialog ref={dialog} className={styles.dialog} data-study-open={visible?"true":"false"} aria-label="背单词" data-motion={motion?"on":"off"} onCancel={e=>{e.preventDefault();onClose();}}>
    <div className={styles.shell}>
      <button className={styles.studyMenu} onClick={()=>window.dispatchEvent(new Event("context-reader-open-main-menu"))}>Menu <span aria-hidden="true">＋</span></button>
      <aside className={styles.rail}><button className={styles.brand} onClick={onClose} aria-label="返回阅读" title="返回阅读"><StudyIcon name="book"/></button>
        <nav aria-label="学习导航">{navigation.map(([key,label,icon])=><button key={key} aria-current={tab===key?"page":undefined} onClick={()=>selectTab(key)}><StudyIcon name={icon}/><span>{label}</span></button>)}</nav>
        <button className={styles.quietExit} onClick={onClose}><StudyIcon name="back"/>返回阅读</button>
      </aside>
      <button className={styles.mobileExit} onClick={onClose} aria-label="关闭背单词"><StudyIcon name="close"/></button>
      <main className={tab==="today"?styles.stage:styles.page}>
        <div className={styles.statusArea}>
          {error&&<div className={styles.error} role="alert"><span>{error}</span>{!pending&&<button disabled={busy} onClick={()=>void run(snapshot?refresh:async()=>accept(await api<StudySnapshot>({op:"prepare"})))}>重试</button>}<button className={styles.iconButton} aria-label="关闭错误提示" onClick={()=>setError("")}><StudyIcon name="close"/></button></div>}
          {busy&&snapshot&&<LoadingStatus className={styles.caption}>正在同步学习记录…</LoadingStatus>}
          {isOffline&&<div className={styles.error} role="status">当前离线，恢复连接后可继续保存进度。</div>}
          {reviews.error&&<div className={styles.error} role="status"><span>{reviews.error}</span><button disabled={isOffline} onClick={()=>void reviews.retry()}>重试同步</button></div>}
        </div>
        {!snapshot?<LoadingStatus className={styles.caption}>正在连接学习记录…</LoadingStatus>:<>
          {tab!=="today"&&<header className={styles.pageHeader}><h1>{title}</h1><button onClick={()=>selectTab("today")}>继续背词<StudyIcon name="arrow"/></button></header>}
          {tab==="today"&&<article ref={questionSurface} tabIndex={-1} data-learning-surface="study" className={styles.flashcard} data-answer={Boolean(intent)} key={cardKey||"empty"} aria-label="当前复习卡片">
            <div className={styles.cardTop}><span className={styles.remainingCounts}>{snapshot.today?<><span>正在背 <b>{remaining.learning}</b></span><span>待复习 <b>{remaining.review}</b></span><span>今日新学 <b>{learnedToday}</b></span></>:"今日学习"}</span>{undoButton}</div>
            {paused?<div className={styles.empty}><StudyIcon name="pause"/><h2>学习已暂停</h2><p>到 {new Date(snapshot.settings.pausedUntil!).toLocaleDateString("zh-CN")}。准备好时，随时回来。</p><button className={styles.primary} disabled={busy||isOffline} onClick={()=>void retryPrepare()}>恢复学习</button></div>:
            (!snapshot.today||progress.total===0)?<div className={styles.empty}><StudyIcon name="book"/><h2>{snapshot.entries.length?"今天没有待学的词":"从一个生词开始"}</h2><p>在阅读或词典里收藏单词，就能在这里复习。</p><button className={styles.primary} onClick={onClose}>去阅读<StudyIcon name="arrow"/></button>{fresh>0&&<button disabled={busy||isOffline} onClick={()=>void retryPrepare()}>检查待学单词</button>}</div>:
            card&&!entry?<div className={styles.empty}>{entryError?<><p role="alert">{entryError}</p><button onClick={retryEntry}>重试读取</button></>:<LoadingStatus>正在读取这个词…</LoadingStatus>}</div>:card&&entry?<>{!intent?<><div className={styles.prompt} lang={card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?"zh-CN":"en"}>{card.mode==="cloze_context"?<><p>{entry.anki.clozeSentence}</p><button className={styles.cue} aria-label={hint?entry.contextMeaning:"中文提示"} aria-expanded={hint} onClick={()=>setHint(v=>!v)}>{hint?entry.contextMeaning:<>中文提示 <kbd>空格</kbd></>}</button></>:card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?<><p>{entry.anki.basicCue||entry.basicMeaning}</p>{!entry.sourceSentence.trim()&&<StudyDictionaryHint entry={entry} visible={hint} onToggle={()=>setHint(v=>!v)}/>}</>:<><p className={styles.word}>{entry.word}</p>{!entry.sourceSentence.trim()?<StudyDictionaryHint entry={entry} visible={hint} onToggle={()=>setHint(v=>!v)}/>:<button className={styles.cue} aria-label={hint?entry.basicMeaning:"中文提示"} aria-expanded={hint} onClick={()=>setHint(v=>!v)}>{hint?entry.basicMeaning:<>中文提示 <kbd>空格</kbd></>}</button>}</>}</div><div className={styles.answers}>{([["forgot","不记得"],["unsure","模糊"],["remembered","记得"]] as const).map(([value,label],i)=><button key={value} data-rating={value} disabled={busy||!reviews.ready||isOffline} onClick={()=>setIntent(value)}><kbd>{i+1}</kbd>{label}</button>)}</div></>:<>
              <div ref={answerBody} className={styles.answerBody} key={cardKey+"answer"} tabIndex={0} aria-label="核对答案"><StudyWord entry={entry} onSource={source} onLookup={openRelatedLookup}/></div>
              <footer className={styles.answerFooter}><div className={styles.nextActions}>{intent==="forgot"||assisted?<button className={styles.primary} disabled={busy||!token||isOffline} data-ui-target="study.next" onClick={()=>void submit("forgot")}>{busyLabel?<LoadingStatus>{busyLabel}</LoadingStatus>:"下一个"}<StudyIcon name="arrow"/></button>:<><button disabled={busy||!token||isOffline} data-ui-target="study.answer-wrong" onClick={()=>void submit(intent==="unsure"?"unsure_wrong":"forgot")}>答错了</button><button className={styles.primary} disabled={busy||!token||isOffline} data-ui-target="study.answer-right" onClick={()=>void submit(intent==="unsure"?"unsure_right":"remembered")}>{busyLabel?<LoadingStatus>{busyLabel}</LoadingStatus>:"答对了"}<StudyIcon name="arrow"/></button></>}</div></footer>
            </>}</>:
            pending?<div className={styles.empty}><StudyIcon name="cards"/><p>正在同步学习记录…</p><button className={styles.primary} onClick={onClose}>先去阅读<StudyIcon name="arrow"/></button></div>:
            completed?<div className={styles.empty}><StudyIcon name="check"/><h2>今天的计划，完成了</h2><p>已完成 {progress.finished} 个词{snapshot.today.reward_points>0?" · "+snapshot.today.reward_points+" 点已到账":""}。</p>{due>0&&<p>其余到期词会按每日计划分批安排。</p>}{!snapshot.today.completed_at&&<button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>{const r=await api<{snapshot:StudySnapshot}>({op:"complete"});accept(r.snapshot);await refreshAccount();})}>保存完成记录</button>}<button className={styles.primary} onClick={onClose}>去阅读<StudyIcon name="arrow"/></button><button onClick={()=>selectTab("rewards")}>查看奖励</button></div>:
            <div className={styles.empty}><StudyIcon name="cards"/><h2>稍后再巩固</h2><p>{queueProgress.waiting.length} 个词待复习 · 约 {Math.max(1,Math.ceil((Math.min(...queueProgress.waiting.map(c=>Date.parse(c.memory.due)))-now.getTime())/60000))} 分钟后继续</p>{queueProgress.blockedNew>0&&<p>复习完成后，再学 {queueProgress.blockedNew} 个新词。</p>}<button className={styles.primary} onClick={onClose}>先去阅读<StudyIcon name="arrow"/></button></div>}
          </article>}
          {tab==="data"&&learningSnapshot&&<StudyStats snapshot={learningSnapshot}/>}
          {tab==="rewards"&&<StudyRewards snapshot={snapshot} busy={busy} onActivate={milestone=>setConfirm(milestone)} onClaim={id=>void claimRewards([id])}/>}
          {tab==="vocabulary"&&learningSnapshot&&<StudyVocabulary snapshot={learningSnapshot} onOpen={openVocabularyEntry}/>}
          {<div hidden={tab!=="settings"}><StudySettingsView value={snapshot.settings} save={settings=>api<StudySnapshot>({op:"settings",settings})} onSaved={acceptSettings} order={order} motion={motion} onDisplay={updateDisplay} paused={paused} onPause={()=>paused?void retryPrepare():setPauseConfirm(true)} onProfile={()=>selectTab("profile")}/></div>}
          {tab==="profile"&&<section className={styles.surface}>{profile?<><div className={styles.sectionHead}><h2>从真实阅读开始</h2></div><dl className={styles.metrics}><div><dt>有效阅读</dt><dd>{Math.floor(profile.activeSeconds/60)}<small>分钟</small></dd></div><div><dt>不同查词</dt><dd>{profile.uniqueLookups}<small>个</small></dd></div></dl>{profile.result&&<div className={styles.profileResult}><h2>{profile.result.recommendedLevel}</h2><p>{profile.result.summary}</p><h3>接下来</h3><ul>{profile.result.focus.map((v,i)=><li key={i}>{v}</li>)}</ul><button onClick={()=>{const current=readRecommendationPreferences();writeRecommendationPreferences({...current,readingLevel:profile.result!.recommendedLevel as RecommendationReadingLevel},{authenticated:true});onClose();}}>按建议难度阅读<StudyIcon name="arrow"/></button></div>}<p className={styles.caption}>累计 {snapshot.policy.minimumReadingMinutes} 分钟有效阅读、{snapshot.policy.minimumLookups} 个不同查词后可生成。画像是阅读建议，不是词汇量测试。</p>{snapshot.policy.profileEnabled?<button className={styles.primary} disabled={!profile.eligible||busy||isOffline} onClick={()=>setConfirm("profile")}>生成画像 · {snapshot.policy.profileCost} 点</button>:<p className={styles.caption}>画像生成暂未开放。</p>}</>:<LoadingStatus >正在读取阅读记录…</LoadingStatus>}</section>}
        </>}
      </main>
      {message&&<div className={styles.toast} role="status">{message}<button className={styles.iconButton} aria-label="关闭通知" onClick={()=>setMessage("")}><StudyIcon name="close"/></button></div>}
      {visible&&rewardNotice&&pendingClaims.length>0&&<StudyDialog title="学习有了新收获" icon="gift" busy={busy} onCancel={()=>setRewardNotice(false)}><p>{pendingClaims.reduce((sum,c)=>sum+c.points-c.claimed_points,0)} 点学习额度{pendingClaims.some(c=>c.plan&&!c.claimed_at)?"，还有会员奖励":""}，已经为你存好。</p><p className={styles.caption}>现在领取，或稍后到学习奖励中领取。</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setRewardNotice(false)}>稍后领取</button><button className={styles.primary} disabled={busy||isOffline} onClick={()=>void claimRewards(pendingClaims.map(c=>c.id))}>{busy?"领取中…":"领取奖励"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&pauseConfirm&&<StudyDialog title="暂时停一停？" icon="pause" busy={busy} onCancel={()=>setPauseConfirm(false)}><p>特殊情况时再暂停。连续天数会重新计算，已经获得的奖励保留。</p><div className={styles.dialogField}><span>暂停时长</span><CetSelect label="暂停时长" value={String(pauseDays)} options={[1,3,7,14,30].map(d=>({key:String(d),text:d+" 天"}))} onChange={d=>setPauseDays(Number(d))}/></div><p className={styles.caption}>记忆仍随时间变化。回来后，按每日计划分批复习。</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setPauseConfirm(false)}>继续坚持</button><button className={styles.primary} disabled={busy||pending} onClick={()=>void run(async()=>{accept(await api<StudySnapshot>({op:"pause",days:pauseDays}));setPauseConfirm(false);setTab("today");})}>{busy?"保存中…":"暂停 "+pauseDays+" 天"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&confirm!==null&&<StudyDialog title={confirm==="profile"?"生成阅读画像？":"启用会员奖励？"} icon={typeof confirm==="number"?"gift":confirm==="profile"?"profile":"cards"} busy={busy} onCancel={()=>setConfirm(null)}><p>{confirm==="profile"?"本次消耗 "+snapshot?.policy.profileCost+" 点。再次查看结果免费。":"奖励从启用时开始计时。同档会员可延长，不同档位需要等当前会员到期。"}</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setConfirm(null)}>取消</button><button className={styles.primary} disabled={busy||isOffline} onClick={()=>{if(confirm==="profile"){setConfirm(null);void generateProfile();}else{const milestone=confirm;void run(async()=>{accept(await api<StudySnapshot>({op:"activateMembership",milestone}));await refreshAccount();setConfirm(null);setMessage("会员奖励已启用");});}}}>{busy?"保存中…":confirm==="profile"?"生成":"启用奖励"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&wordDetail&&<StudyDialog title={wordDetail.word} wide onCopy={completeWordDetail?()=>{void navigator.clipboard.writeText([completeWordDetail.word,completeWordDetail.contextMeaning,completeWordDetail.basicMeaning,completeWordDetail.sourceSentence,completeWordDetail.sentenceTranslation].filter(Boolean).join("\n")).then(()=>setMessage("已复制")).catch(()=>setMessage("复制失败，请重试"));}:undefined} onCancel={()=>setWordDetailId(null)}><div className={styles.wordDetail}><StudyWord entry={wordDetail} onSource={source} onLookup={openRelatedLookup}/></div></StudyDialog>}
      {visible&&relatedQuery&&<DictionaryWindow modal onClose={()=>setRelatedQuery(null)}><BookDictionary key={relatedQuery} embedded panel offline={isOffline} initialQuery={relatedQuery} onAddToVocabulary={async result=>{
        setRelatedEntries(addVocabularyEntry(createStandaloneVocabularyEntry(result)));
        try { await flushLearningStorage(); setMessage("已加入生词本"); } catch { setMessage("生词尚未可靠保存，请保留页面并重试。"); }
      }} isInVocabulary={result=>relatedEntries.some(entry=>vocabularyIdentity(entry)===vocabularyIdentity(createStandaloneVocabularyEntry(result)))}/></DictionaryWindow>}
    </div>
  </dialog>;
}
