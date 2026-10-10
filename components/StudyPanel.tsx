"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";
import { useDocumentScrollLock } from "./useDocumentScrollLock";
import { useStudyTimer } from "./useStudyTimer";
import { StudyRewards } from "./StudyRewards";
import { StudyIcon, type StudyIconName } from "./StudyIcon";
import { StudyDialog } from "./StudyDialog";
import { StudyWord } from "./StudyWord";
import { StudySettings as StudySettingsView } from "./StudySettings";
import { StudyVocabulary } from "./StudyVocabulary";
import { StudyStats } from "./StudyStats";
import { CetSelect } from "./cet/CetSelect";
import { activeStudySnapshot, chooseStudyCard } from "@/lib/studyPresentation";
import type { VocabularyEntry } from "@/types/vocabulary";
import { openStudySource } from "@/lib/studyNavigation";
import { planProgress, shanghaiDay, studyPaused } from "@/lib/studyScheduler";
import type { StudyAnswer, StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";
import { readRecommendationPreferences, writeRecommendationPreferences, type RecommendationReadingLevel } from "@/lib/recommendationPreferences";

type Tab = "today" | "vocabulary" | "data" | "rewards" | "settings" | "profile";
type Pending = { op: string; id: string; cardId: string; version: number; token: string; answer: StudyAnswer; activeMs: number };
const navigation: Array<[Tab,string,StudyIconName]> = [["today","背单词","cards"],["vocabulary","生词本","book"],["data","学习数据","chart"],["rewards","学习奖励","gift"],["settings","设置","settings"]];
export function StudyPanel({visible,onClose,onSource,notice}:{visible:boolean;onClose:()=>void;onSource:()=>void;notice:string}) {
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
  const [wordDetail,setWordDetail]=useState<VocabularyEntry|null>(null);
  const [rewardNotice,setRewardNotice]=useState(false);
  const priorClaims=useRef(new Map<string,number>());
  const randomRanks=useRef(new Map<string,number>());
  const answerBody=useRef<HTMLDivElement>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [profile,setProfile]=useState<{activeSeconds:number;uniqueLookups:number;result?:{summary:string;recommendedLevel:string;strengths:string[];focus:string[]};eligible:boolean}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const alive=useRef(true);
  const pendingRef=useRef<Pending|null>(null);
  const displayed=useRef("");
  const profileAction=useRef("");
  const offset=useRef(0),requestLock=useRef(false);
  const storageKey="context-reader-study-pending:"+owner;
  useDocumentScrollLock(visible);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const accept=useCallback((s:StudySnapshot)=>{
    if(!alive.current)return;
    for(const claim of s.claims??[]){
      const pending=claim.points-claim.claimed_points+(claim.plan&&!claim.claimed_at?1:0);
      if(pending>(priorClaims.current.get(claim.id)??0))setRewardNotice(true);
      priorClaims.current.set(claim.id,pending);
    }
    offset.current=Date.parse(s.serverNow)-Date.now();setSnapshot(s);setTick(Date.now());
  },[]);
  const api=useCallback(async <T,>(body?:unknown):Promise<T>=>{
    const response=await fetch("/api/study",{method:body?"POST":"GET",headers:{"Content-Type":"application/json","X-Context-Account":owner},body:body?JSON.stringify(body):undefined,cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||"暂时无法保存，请稍后重试。"),{code:data.code,status:response.status});
    return data as T;
  },[owner]);
  const run=async(fn:()=>Promise<void>)=>{
    if(requestLock.current)return;
    requestLock.current=true;setBusy(true);setError("");
    try{await fn();}catch(e){if(alive.current)setError(e instanceof TypeError?"网络未连接。请恢复连接后重试，当前答案仍然保留。":(e as Error).message);}
    finally{requestLock.current=false;if(alive.current)setBusy(false);}
  };
  useEffect(()=>{
    void run(async()=>{
      await syncNow({dirtyKinds:["vocabulary"]}).catch(()=>{});
      accept(await api<StudySnapshot>({op:"start"}));
    });
    try{const local=JSON.parse(localStorage.getItem("context-reader-study-display:"+owner)||"{}");setOrder(local.order==="random"?"random":"ordered");setMotion(local.motion!==false);}catch{}
    try{profileAction.current=sessionStorage.getItem("context-reader-profile-action:"+owner)||"";}catch{}
    try{const p=JSON.parse(sessionStorage.getItem(storageKey)||"null") as Pending|null;pendingRef.current=p;setPending(p);}catch{}
  // A single account-scoped load; a sync callback changing must not reset a card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner]);
  const previouslyVisible=useRef(false);
  useEffect(()=>{
    if(visible&&!previouslyVisible.current&&snapshot&&!pendingRef.current)void run(async()=>{await syncNow({dirtyKinds:["vocabulary"]}).catch(()=>{});accept(await api<StudySnapshot>({op:"start"}));});
    previouslyVisible.current=visible;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[visible]);
  useEffect(()=>{if(notice)setMessage(notice);},[notice]);
  useEffect(()=>{if(!message)return;const id=setTimeout(()=>setMessage(""),5000);return()=>clearTimeout(id);},[message]);
  useEffect(()=>{
    const el=dialog.current;if(!el)return;
    if(visible&&!el.open)el.showModal();else if(!visible&&el.open)el.close();
  },[visible]);
  useEffect(()=>{if(!visible)return;setTick(Date.now());const id=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(id);},[visible]);
  const now=new Date(tick+offset.current);
  const learningSnapshot=useMemo(()=>snapshot?activeStudySnapshot(snapshot):null,[snapshot]);
  const progress=useMemo(()=>planProgress(learningSnapshot?.cards??[],snapshot?.today?.card_ids??[],new Date(tick+offset.current),snapshot?.today?.new_ids),[snapshot,learningSnapshot,tick]);
  for(const ready of progress.ready)if(!randomRanks.current.has(ready.id))randomRanks.current.set(ready.id,Math.random());
  const card=chooseStudyCard(progress.ready,displayed.current,order,randomRanks.current);
  useEffect(()=>{displayed.current=card?.id??"";},[card?.id]);
  const entry=snapshot?.entries.find(e=>e.id===card?.entry_id);
  const cardKey=card?card.id+":"+card.version:"";
  useEffect(()=>{setIntent(null);setHint(false);setAssisted(false);answerBody.current?.scrollTo(0,0);},[cardKey]);
  const activeMs=useStudyTimer(visible&&tab==="today"&&Boolean(card)&&Boolean(token)&&!busy&&!pending&&!pauseConfirm&&confirm===null&&!wordDetail&&!rewardNotice&&!menuOpen,cardKey,owner);
  useEffect(()=>{
    setToken("");
    if(!visible||!card||pendingRef.current)return;
    let cancelled=false;
    void api<{token:string}>({op:"present",cardId:card.id,version:card.version}).then(r=>{if(!cancelled)setToken(r.token);}).catch(e=>{if(!cancelled)setError((e as Error).message);});
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cardKey,api,presentation,visible]);
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{
      if(menuOpen||!visible||tab!=="today"||busy||!card||pending||confirm!==null||pauseConfirm||wordDetail||rewardNotice||["INPUT","SELECT","TEXTAREA"].includes((e.target as HTMLElement)?.tagName))return;
      if(!intent&&["1","2","3"].includes(e.key)){e.preventDefault();setIntent(e.key==="1"?"forgot":e.key==="2"?"unsure":"remembered");}
    };
    window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);
  },[visible,tab,busy,card,pending,intent,confirm,pauseConfirm,wordDetail,rewardNotice,menuOpen]);
  const submit=async(answer:StudyAnswer)=>{
    if(!card||!token)return;
    const p:Pending={op:"review",id:crypto.randomUUID(),cardId:card.id,version:card.version,token,answer,activeMs:activeMs()};
    pendingRef.current=p;setPending(p);
    try{sessionStorage.setItem(storageKey,JSON.stringify(p));}catch{}
    await savePending(p);
  };
  const clearPending=()=>{pendingRef.current=null;setPending(null);try{sessionStorage.removeItem(storageKey);}catch{}};
  const refresh=async()=>{accept(await api<StudySnapshot>());setPresentation(n=>n+1);};
  const savePending=async(p:Pending)=>run(async()=>{
    try {
      let data:{snapshot:StudySnapshot};
      try { data=await api<{snapshot:StudySnapshot}>(p); }
      catch(e){
        if((e as {code?:string}).code!=="too_fast")throw e;
        // Preserve the server timing guard and the same idempotent answer; quick taps need no error dialog.
        await new Promise(resolve=>setTimeout(resolve,850));
        data=await api<{snapshot:StudySnapshot}>(p);
      }
      clearPending();accept(data.snapshot);setPresentation(n=>n+1);
    } catch(e) {
      if((e as {code?:string}).code==="state_changed"){clearPending();await refresh();}
      throw e;
    }
  });
  const currentDay=shanghaiDay(now);
  useEffect(()=>{
    if(snapshot?.today&&snapshot.today.day!==currentDay&&!pending&&!busy)void run(async()=>{accept(await api<StudySnapshot>({op:"start"}));setPresentation(n=>n+1);});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentDay,snapshot?.today?.day,pending,busy]);
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
  const paused=snapshot?studyPaused(snapshot.settings,now):false;
  const due=learningSnapshot?.cards.filter(c=>c.memory.state!==0&&Date.parse(c.memory.due)<=now.getTime()).length??0;
  const fresh=learningSnapshot?.cards.filter(c=>c.memory.state===0).length??0;
  const completed=progress.total>0&&progress.finished===progress.total;
  const lastReview=snapshot?.reviews.find(r=>!r.undone);
  const undo=()=>run(async()=>{
    if(!lastReview)return;
    const restored=await api<StudySnapshot>({op:"undo",id:lastReview.id});
    displayed.current=lastReview.card_id;accept(restored);setPresentation(n=>n+1);setMessage("已回到上一张");
  });
  const source=(word:VocabularyEntry)=>{
    if(word.id===entry?.id)setAssisted(true);
    setWordDetail(null);onSource();setTimeout(()=>openStudySource(word),80);
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
          {isOffline&&<div className={styles.error} role="status">当前离线，恢复连接后可继续保存进度。</div>}
          {pending&&!busy&&<div className={styles.error} role="status"><span>刚才的答案还未保存。</span><button disabled={busy||isOffline} onClick={()=>void savePending(pending)}>重试保存</button></div>}
        </div>
        {!snapshot?<p className={styles.caption} role="status">正在连接学习记录…</p>:<>
          {tab!=="today"&&<header className={styles.pageHeader}><h1>{title}</h1><button onClick={()=>selectTab("today")}>继续背词<StudyIcon name="arrow"/></button></header>}
          {tab==="today"&&<article data-learning-surface="study" className={styles.flashcard} data-answer={Boolean(intent)} key={cardKey||"empty"} aria-label="当前复习卡片">
            <div className={styles.cardTop}><span>{snapshot.today?<>{card?(snapshot.today.new_ids.includes(card.id)?"新词":"复习"):"今日学习"}<span className={styles.counterDivider}> · </span>今天已学完 <b>{progress.finished}</b> 词</>:"今日学习"}</span>{undoButton}</div>
            {paused?<div className={styles.empty}><StudyIcon name="pause"/><h2>学习已暂停</h2><p>到 {new Date(snapshot.settings.pausedUntil!).toLocaleDateString("zh-CN")}。准备好时，随时回来。</p><button className={styles.primary} disabled={busy||isOffline} onClick={()=>void retryPrepare()}>恢复学习</button></div>:
            (!snapshot.today||progress.total===0)?<div className={styles.empty}><StudyIcon name="book"/><h2>{snapshot.entries.length?"今天没有待学的词":"从一个生词开始"}</h2><p>在阅读或词典里收藏单词，就能在这里复习。</p><button className={styles.primary} onClick={onClose}>去阅读<StudyIcon name="arrow"/></button>{fresh>0&&<button disabled={busy||isOffline} onClick={()=>void retryPrepare()}>检查待学单词</button>}</div>:
            card&&entry?<>{!intent?<><div className={styles.prompt} lang={card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?"zh-CN":"en"}>{card.mode==="cloze_context"?<><p>{entry.anki.clozeSentence}</p><button className={styles.cue} aria-expanded={hint} onClick={()=>setHint(v=>!v)}>{hint?entry.contextMeaning:"中文提示"}</button></>:card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?<p>{entry.anki.basicCue||entry.basicMeaning}</p>:<p className={styles.word}>{entry.word}</p>}</div><div className={styles.answers}>{([["forgot","不记得"],["unsure","模糊"],["remembered","记得"]] as const).map(([value,label],i)=><button key={value} data-rating={value} disabled={busy||Boolean(pending)||isOffline} onClick={()=>setIntent(value)}><kbd>{i+1}</kbd>{label}</button>)}</div></>:<>
              <div ref={answerBody} className={styles.answerBody} key={cardKey+"answer"} tabIndex={0} aria-label="核对答案"><StudyWord entry={entry} onSource={source}/></div>
              <footer className={styles.answerFooter}><span className={styles.feedback}>{assisted?"已看原文，稍后再练":intent==="forgot"?"看懂后，再练一次":intent==="unsure"?"模糊时，也核对对错":"核对刚才的回忆"}</span><div className={styles.nextActions}>{intent==="forgot"||assisted?<button className={styles.primary} disabled={busy||!token||Boolean(pending)||isOffline} onClick={()=>void submit("forgot")}>{busyLabel||"下一个"}<StudyIcon name="arrow"/></button>:<><button disabled={busy||!token||Boolean(pending)||isOffline} onClick={()=>void submit(intent==="unsure"?"unsure_wrong":"forgot")}>答错了</button><button className={styles.primary} disabled={busy||!token||Boolean(pending)||isOffline} onClick={()=>void submit(intent==="unsure"?"unsure_right":"remembered")}>{busyLabel||"答对了"}<StudyIcon name="arrow"/></button></>}</div></footer>
            </>}</>:
            completed?<div className={styles.empty}><StudyIcon name="check"/><h2>今天的计划，完成了</h2><p>已完成 {progress.finished} 个词{snapshot.today.reward_points>0?" · "+snapshot.today.reward_points+" 点已到账":""}。</p>{due>0&&<p>其余到期词会按每日计划分批安排。</p>}{!snapshot.today.completed_at&&<button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>{const r=await api<{snapshot:StudySnapshot}>({op:"complete"});accept(r.snapshot);await refreshAccount();})}>保存完成记录</button>}<button className={styles.primary} onClick={onClose}>去阅读<StudyIcon name="arrow"/></button><button onClick={()=>selectTab("rewards")}>查看奖励</button></div>:
            <div className={styles.empty}><StudyIcon name="cards"/><h2>稍后再巩固</h2><p>{progress.waiting.length} 个词待复习 · 约 {Math.max(1,Math.ceil((Math.min(...progress.waiting.map(c=>Date.parse(c.memory.due)))-now.getTime())/60000))} 分钟后继续</p>{progress.blockedNew>0&&<p>复习完成后，再学 {progress.blockedNew} 个新词。</p>}<button className={styles.primary} onClick={onClose}>先去阅读<StudyIcon name="arrow"/></button></div>}
          </article>}
          {tab==="data"&&learningSnapshot&&<StudyStats snapshot={learningSnapshot}/>}
          {tab==="rewards"&&<StudyRewards snapshot={snapshot} busy={busy} onActivate={milestone=>setConfirm(milestone)} onClaim={id=>void claimRewards([id])}/>}
          {tab==="vocabulary"&&learningSnapshot&&<StudyVocabulary snapshot={learningSnapshot} onOpen={setWordDetail}/>}
          {<div hidden={tab!=="settings"}><StudySettingsView value={snapshot.settings} save={settings=>api<StudySnapshot>({op:"settings",settings})} onSaved={s=>setSnapshot(current=>current?{...current,settings:s.settings}:s)} order={order} motion={motion} onDisplay={updateDisplay} paused={paused} onPause={()=>paused?void retryPrepare():setPauseConfirm(true)} onProfile={()=>selectTab("profile")}/></div>}
          {tab==="profile"&&<section className={styles.surface}>{profile?<><div className={styles.sectionHead}><h2>从真实阅读开始</h2></div><dl className={styles.metrics}><div><dt>有效阅读</dt><dd>{Math.floor(profile.activeSeconds/60)}<small>分钟</small></dd></div><div><dt>不同查词</dt><dd>{profile.uniqueLookups}<small>个</small></dd></div></dl>{profile.result&&<div className={styles.profileResult}><h2>{profile.result.recommendedLevel}</h2><p>{profile.result.summary}</p><h3>接下来</h3><ul>{profile.result.focus.map((v,i)=><li key={i}>{v}</li>)}</ul><button onClick={()=>{const current=readRecommendationPreferences();writeRecommendationPreferences({...current,readingLevel:profile.result!.recommendedLevel as RecommendationReadingLevel},{authenticated:true});onClose();}}>按建议难度阅读<StudyIcon name="arrow"/></button></div>}<p className={styles.caption}>累计 {snapshot.policy.minimumReadingMinutes} 分钟有效阅读、{snapshot.policy.minimumLookups} 个不同查词后可生成。画像是阅读建议，不是词汇量测试。</p>{snapshot.policy.profileEnabled?<button className={styles.primary} disabled={!profile.eligible||busy||isOffline} onClick={()=>setConfirm("profile")}>生成画像 · {snapshot.policy.profileCost} 点</button>:<p className={styles.caption}>画像生成暂未开放。</p>}</>:<p role="status">正在读取阅读记录…</p>}</section>}
        </>}
      </main>
      {message&&<div className={styles.toast} role="status">{message}<button className={styles.iconButton} aria-label="关闭通知" onClick={()=>setMessage("")}><StudyIcon name="close"/></button></div>}
      {visible&&rewardNotice&&pendingClaims.length>0&&<StudyDialog title="学习有了新收获" icon="gift" busy={busy} onCancel={()=>setRewardNotice(false)}><p>{pendingClaims.reduce((sum,c)=>sum+c.points-c.claimed_points,0)} 点学习额度{pendingClaims.some(c=>c.plan&&!c.claimed_at)?"，还有会员奖励":""}，已经为你存好。</p><p className={styles.caption}>现在领取，或稍后到学习奖励中领取。</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setRewardNotice(false)}>稍后领取</button><button className={styles.primary} disabled={busy||isOffline} onClick={()=>void claimRewards(pendingClaims.map(c=>c.id))}>{busy?"领取中…":"领取奖励"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&pauseConfirm&&<StudyDialog title="暂时停一停？" icon="pause" busy={busy} onCancel={()=>setPauseConfirm(false)}><p>特殊情况时再暂停。连续天数会重新计算，已经获得的奖励保留。</p><div className={styles.dialogField}><span>暂停时长</span><CetSelect label="暂停时长" value={String(pauseDays)} options={[1,3,7,14,30].map(d=>({key:String(d),text:d+" 天"}))} onChange={d=>setPauseDays(Number(d))}/></div><p className={styles.caption}>记忆仍随时间变化。回来后，按每日计划分批复习。</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setPauseConfirm(false)}>继续坚持</button><button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>{accept(await api<StudySnapshot>({op:"pause",days:pauseDays}));setPauseConfirm(false);setTab("today");})}>{busy?"保存中…":"暂停 "+pauseDays+" 天"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&confirm!==null&&<StudyDialog title={confirm==="profile"?"生成阅读画像？":"启用会员奖励？"} icon={typeof confirm==="number"?"gift":confirm==="profile"?"profile":"cards"} busy={busy} onCancel={()=>setConfirm(null)}><p>{confirm==="profile"?"本次消耗 "+snapshot?.policy.profileCost+" 点。再次查看结果免费。":"奖励从启用时开始计时。同档会员可延长，不同档位需要等当前会员到期。"}</p><div className={styles.dialogActions}><button autoFocus disabled={busy} onClick={()=>setConfirm(null)}>取消</button><button className={styles.primary} disabled={busy||isOffline} onClick={()=>{if(confirm==="profile"){setConfirm(null);void generateProfile();}else{const milestone=confirm;void run(async()=>{accept(await api<StudySnapshot>({op:"activateMembership",milestone}));await refreshAccount();setConfirm(null);setMessage("会员奖励已启用");});}}}>{busy?"保存中…":confirm==="profile"?"生成":"启用奖励"}</button></div>{error&&<p className={styles.dialogError} role="alert">{error}</p>}</StudyDialog>}
      {visible&&wordDetail&&<StudyDialog title={wordDetail.word} wide onCopy={()=>{void navigator.clipboard.writeText([wordDetail.word,wordDetail.contextMeaning,wordDetail.basicMeaning,wordDetail.sourceSentence,wordDetail.sentenceTranslation].filter(Boolean).join("\n")).then(()=>setMessage("已复制")).catch(()=>setMessage("复制失败，请重试"));}} onCancel={()=>setWordDetail(null)}><div className={styles.wordDetail}><StudyWord entry={wordDetail} onSource={source}/></div></StudyDialog>}
    </div>
  </dialog>;
}
