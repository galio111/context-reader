"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";
import { PronunciationButtons } from "./PronunciationButtons";
import { useDocumentScrollLock } from "./useDocumentScrollLock";
import { useStudyTimer } from "./useStudyTimer";
import { StudyRewards } from "./StudyRewards";
import { openStudySource } from "@/lib/studyNavigation";
import { planProgress, recallProbability, shanghaiDay, studyPaused } from "@/lib/studyScheduler";
import type { StudyAnswer, StudySettings, StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";
import { readRecommendationPreferences, writeRecommendationPreferences, type RecommendationReadingLevel } from "@/lib/recommendationPreferences";

type Tab = "today" | "data" | "settings" | "profile";
type Pending = { op: string; id: string; cardId: string; version: number; token: string; answer: StudyAnswer; activeMs: number };
function minutes(ms:number) { return ms<60000 ? Math.round(ms/1000)+" 秒" : (ms/60000).toFixed(1)+" 分钟"; }
function PauseConfirmation({children,busy,onCancel}:{children:React.ReactNode;busy:boolean;onCancel:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className={styles.confirm} aria-label="确认特殊情况暂停" onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)onCancel();}}><h3>需要暂时停一停吗？</h3>{children}</dialog>;
}
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
  const [settings,setSettings]=useState<StudySettings|null>(null);
  const [pauseDays,setPauseDays]=useState(3),[pauseConfirm,setPauseConfirm]=useState(false);
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
    offset.current=Date.parse(s.serverNow)-Date.now();setSnapshot(s);setSettings(s.settings);setTick(Date.now());
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
    void run(async()=>{await syncNow({dirtyKinds:["vocabulary"]}).catch(()=>{});accept(await api<StudySnapshot>({op:"prepare"}));});
    try{profileAction.current=sessionStorage.getItem("context-reader-profile-action:"+owner)||"";}catch{}
    try{const p=JSON.parse(sessionStorage.getItem(storageKey)||"null") as Pending|null;pendingRef.current=p;setPending(p);}catch{}
  // A single account-scoped load; a sync callback changing must not reset a card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[owner]);
  useEffect(()=>{
    const el=dialog.current;if(!el)return;
    if(visible&&!el.open)el.showModal();else if(!visible&&el.open)el.close();
  },[visible]);
  useEffect(()=>{const id=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(id);},[]);
  const now=new Date(tick+offset.current);
  const progress=useMemo(()=>planProgress(snapshot?.cards??[],snapshot?.today?.card_ids??[],new Date(tick+offset.current),snapshot?.today?.new_ids),[snapshot,tick]);
  const card=progress.ready.find(c=>c.id===displayed.current)??progress.ready[0];
  useEffect(()=>{displayed.current=card?.id??"";},[card?.id]);
  const entry=snapshot?.entries.find(e=>e.id===card?.entry_id);
  const cardKey=card?card.id+":"+card.version:"";
  const activeMs=useStudyTimer(visible&&tab==="today"&&Boolean(card)&&Boolean(token)&&!busy&&!pending,cardKey);
  useEffect(()=>{
    setIntent(null);setAssisted(false);setToken("");
    if(!card||pendingRef.current)return;
    let cancelled=false;
    void api<{token:string}>({op:"present",cardId:card.id,version:card.version}).then(r=>{if(!cancelled)setToken(r.token);}).catch(e=>{if(!cancelled)setError((e as Error).message);});
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cardKey,api,presentation]);
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{
      if(!visible||tab!=="today"||busy||!card||!token||pending||["INPUT","SELECT","TEXTAREA","BUTTON"].includes((e.target as HTMLElement)?.tagName))return;
      if(!intent&&["1","2","3"].includes(e.key)){e.preventDefault();setIntent(e.key==="1"?"forgot":e.key==="2"?"unsure":"remembered");}
    };
    window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);
  },[visible,tab,busy,card,token,pending,intent]);
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
      const data=await api<{snapshot:StudySnapshot}>(p);clearPending();accept(data.snapshot);setPresentation(n=>n+1);
      if(data.snapshot.today?.completed_at){await refreshAccount();setMessage(data.snapshot.today.reward_points?"今日计划已完成，"+data.snapshot.today.reward_points+" 点学习额度已到账。":"今日计划已完成，学习记录已经保存。");}
    } catch(e) {
      if((e as {code?:string}).code==="state_changed"){clearPending();await refresh();}
      throw e;
    }
  });
  const currentDay=shanghaiDay(now);
  useEffect(()=>{
    if(snapshot?.today&&snapshot.today.day!==currentDay&&!pending&&!busy)void run(refresh);
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
  const todayStat=snapshot?.daily.find(d=>d.day===shanghaiDay(now));
  const imported=snapshot?.cards.filter(c=>c.anki_pending).length??0;
  const due=snapshot?.cards.filter(c=>c.memory.state!==0&&Date.parse(c.memory.due)<=now.getTime()).length??0;
  const fresh=snapshot?.cards.filter(c=>c.memory.state===0).length??0;
  const steady=snapshot?.cards.filter(c=>c.memory.state===2&&c.memory.stability>=21&&(recallProbability(c.memory,now)??0)>=.9).length??0;
  const completed=progress.total>0&&progress.finished===progress.total;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="study-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <div className={styles.shell}>
      <header className={styles.header}><div><span className={styles.brand}>Context Reader</span><h1 id="study-title">让读过的词，留在记忆里</h1></div><button className={styles.close} onClick={onClose} aria-label="关闭背单词">返回阅读 ↗</button></header>
      <nav className={styles.tabs} aria-label="学习导航">{([["today","今日复习"],["data","我的进度"],["settings","学习安排"],["profile","阅读画像"]] as const).map(([key,label])=><button key={key} aria-current={tab===key?"page":undefined} onClick={()=>{setTab(key);if(key==="profile")void loadProfile();}}>{label}</button>)}</nav>
      <div className={styles.content}>
        {error&&<div className={styles.error} role="alert">{error} {!pending&&<button onClick={()=>void run(refresh)}>刷新记录</button>}</div>}
        {message&&<p className={styles.message} role="status">{message}</p>}
        {isOffline&&<p className={styles.error}>当前离线。复习进度需要联网保存，恢复连接后可继续。</p>}
        {!snapshot?<div className={styles.empty} role="status"><h2>正在准备你的生词</h2><p>先同步已保存的内容，再继续学习。</p></div>:<>
        {tab==="today"&&<>
          <div className={styles.todayTop}><div><span>今天 · {shanghaiDay(now)}</span><h2>{paused?"给自己一点时间":completed?"今天的计划完成了":snapshot.today?"一步一步，记住它们":"从今天开始，积少成多"}</h2></div><div className={styles.time}><strong>{minutes(todayStat?.active_ms??0)}</strong><span>今日有效学习时间</span></div></div>
          {snapshot.today&&<div className={styles.progress}><progress max={Math.max(1,progress.total)} value={progress.finished}/><span>{progress.finished} / {progress.total} 个词已完成</span></div>}
          {pending&&<div className={styles.error} role="status">有一个答案正在等待确认。重复提交不会重复计分。<button disabled={busy||isOffline} onClick={()=>void savePending(pending)}>重试保存</button></div>}
          {paused?<div className={styles.empty}><h3>已暂停到 {new Date(snapshot.settings.pausedUntil!).toLocaleDateString("zh-CN")}</h3><p>记忆仍随时间变化。恢复后按每日计划分批复习，不需要一天补完。</p><button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>accept(await api<StudySnapshot>({op:"resume"})))}>恢复学习</button></div>:
          !snapshot.today?<div className={styles.start}><p>固定先完成当天到期复习，再学新词。卡片安排会随着你的回答逐步调整。</p><div className={styles.statsLine}><span><strong>{due}</strong> 到期复习</span><span><strong>{fresh}</strong> 尚未开始</span></div>
            {imported>0&&!snapshot.settings.includeAnki&&<p className={styles.explain}>{imported} 个词已有 Anki 导入记录。它们的 Anki 进度尚未迁移，默认暂不开始站内学习；Anki 原有功能与数据继续保留。可在“学习安排”里主动选择从头学习。</p>}
            <button className={styles.primary} disabled={busy||isOffline} onClick={()=>void run(async()=>{await syncNow({dirtyKinds:["vocabulary"]});accept(await api<StudySnapshot>({op:"start"}));})}>{busy?"正在准备…":"开始今日计划"}</button>
            {!snapshot.entries.length&&<p>在阅读或词典中加入生词，就能在这里复习。<button onClick={onClose}>去阅读</button></p>}
          </div>:
          card&&entry?<article className={styles.flashcard} aria-label="当前复习卡片">
            <div className={styles.cardMeta}><span>{card.memory.state===0?"第一次学习":card.memory.state===1||card.memory.state===3?"短期巩固":"到期复习"}</span><span>{entry.sourceSentence?"来自你的阅读":"来自单独查词"}</span></div>
            <div className={styles.prompt} lang={card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?"zh-CN":"en"}>{card.mode==="cloze_context"?<><p>{entry.anki.clozeSentence}</p><span className={styles.cue}>{entry.contextMeaning}</span></>:card.mode==="basic_cn_to_en"||card.mode==="basic_cn_to_en_dictionary"?<p>{entry.anki.basicCue||entry.basicMeaning}</p>:<p className={styles.word}>{entry.word}</p>}</div>
            {!intent?<><p className={styles.promptHint}>先在心里回答，再核对答案。</p><div className={styles.answers}><button disabled={!token||busy||Boolean(pending)} onClick={()=>setIntent("forgot")}><span>1</span>不记得</button><button disabled={!token||busy||Boolean(pending)} onClick={()=>setIntent("unsure")}><span>2</span>模糊</button><button disabled={!token||busy||Boolean(pending)} onClick={()=>setIntent("remembered")}><span>3</span>记得</button></div></>:
            <><section className={styles.answer} aria-label="核对答案"><div className={styles.answerTitle}><h3>{entry.word}</h3><span>{entry.phonetic}</span><PronunciationButtons text={entry.word}/></div><p>{entry.contextMeaning||entry.basicMeaning}</p>{entry.sourceSentence&&<blockquote>{entry.sourceSentence}<small>{entry.sentenceTranslation}</small></blockquote>}<details><summary>更多释义与用法</summary><p>{entry.basicMeaning}</p><p>{entry.usageNote}</p><p>{entry.collocation}</p><p>{entry.exampleEnglish}</p><p>{entry.exampleChinese}</p></details></section>
              {assisted?<p className={styles.explain}>本次查看了原文提示，将按“不记得”安排重新学习。</p>:<p className={styles.promptHint}>{intent==="unsure"?"核对刚才的回忆：虽然模糊，但答对了吗？":intent==="forgot"?"看懂答案后，稍后再试一次。":"刚才独立想出的答案正确吗？"}</p>}
              <div className={styles.answers}>{intent==="forgot"||assisted?<button className={styles.primary} disabled={busy||!token||Boolean(pending)} onClick={()=>void submit("forgot")}>明白了，稍后再练</button>:<><button disabled={busy||!token||Boolean(pending)} onClick={()=>void submit(intent==="unsure"?"unsure_wrong":"forgot")}>答错了</button><button className={styles.primary} disabled={busy||!token||Boolean(pending)} onClick={()=>void submit(intent==="unsure"?"unsure_right":"remembered")}>{intent==="unsure"?"模糊，但答对了":"答对了"}</button></>}</div>
              {entry.sourceSentence&&<button className={styles.sourceLink} onClick={()=>{setAssisted(true);onSource();setTimeout(()=>openStudySource(entry),80);}}>查看原文 · 返回后继续这张卡 ↗</button>}
            </>}
          </article>:
          completed?<div className={styles.empty}><h3>今天的努力，已经存好了</h3><p>{due>0?"仍有 "+due+" 个到期词，后续按每日计划分批恢复。":"可以去读一篇外刊，或做一组真题，让词汇回到真实语境。"}</p>
            {snapshot.policy.rewardsEnabled&&<p>{snapshot.today.completed_at?"今天完成 "+snapshot.today.new_completed+" 个新词，共到账 "+snapshot.today.reward_points+" 点。":"完成后按首次学完的新词计算奖励，普通复习不重复发放。"}</p>}
            <button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>{const r=await api<{completion:{points:number};snapshot:StudySnapshot}>({op:"complete"});accept(r.snapshot);await refreshAccount();setMessage(r.completion.points?"已到账 "+r.completion.points+" 点学习额度。":"今日完成记录已保存。");})}>{snapshot.today.completed_at?"已记录今日完成":snapshot.policy.rewardsEnabled?"完成并领取奖励":"记录今日完成"}</button><button className={styles.sourceLink} onClick={onClose}>继续阅读外刊或真题 →</button></div>:
          <div className={styles.empty}><h3>给记忆留一点间隔</h3><p>{progress.waiting.length} 个词还需要短期巩固，下一张约 {Math.max(1,Math.ceil((Math.min(...progress.waiting.map(c=>Date.parse(c.memory.due)))-now.getTime())/60000))} 分钟后到期。</p>{progress.blockedNew>0&&<p>先完成这些复习，再开始 {progress.blockedNew} 个新词。这个顺序固定，不需要设置。</p>}<p>可以先去阅读，回来会接着当前计划继续。</p><button onClick={onClose}>先去阅读</button></div>}
          {!snapshot.today?.completed_at&&snapshot.reviews.find(r=>!r.undone)&&<button className={styles.undo} disabled={busy||Boolean(pending)} onClick={()=>void run(async()=>{accept(await api<StudySnapshot>({op:"undo",id:snapshot.reviews.find(r=>!r.undone)!.id}));setMessage("已撤销这次答题，恢复此前的记忆状态。");})}>撤销最近一次答题</button>}
          <p className={styles.footnote}>FSRS 科学安排间隔 · 复习本身不消耗学习额度 · 进度保存到你的账号</p>
          {snapshot.policy.rewardsEnabled&&<p className={styles.rewardIntro}>新学每词奖励 {snapshot.policy.pointsPerNew} 点，每天最高 {snapshot.policy.dailyRewardCap} 点；连续学习还可获得额度和会员。</p>}
          <StudyRewards snapshot={snapshot} busy={busy} onActivate={milestone=>void run(async()=>{accept(await api<StudySnapshot>({op:"activateMembership",milestone}));await refreshAccount();setMessage("会员奖励已启用。");})}/>
        </>}
        {tab==="data"&&<section><h2>看得懂的学习进度</h2><div className={styles.metrics}><div><strong>{fresh}</strong><span>还没开始</span></div><div><strong>{snapshot.cards.length-fresh-steady}</strong><span>正在巩固</span></div><div><strong>{steady}</strong><span>较为稳固</span></div><div><strong>{minutes(todayStat?.active_ms??0)}</strong><span>今天实际学习</span></div></div><p className={styles.explain}>“较为稳固”表示已经进入长期复习、记忆稳定性至少 21 天，且此时预计能记住的概率不低于 90%。它仍会随时间变化，不代表永远不会忘。</p>
          <h3>最近的学习</h3><p className={styles.explain}>时间只累计卡片前台作答，切换页面、查看原文和长时间停留会暂停计时；每次作答最多计一分钟。</p><div className={styles.history}>{snapshot.daily.length?snapshot.daily.slice(-14).reverse().map(d=><div key={d.day}><time>{d.day}</time><span>{d.cards} 个词 · {d.reviews} 次练习</span><span>{minutes(d.active_ms)}</span></div>):<p>完成第一张卡后，这里会开始记录。</p>}</div><details><summary>“答对比例”是什么意思？</summary><p>最近 90 天的有效作答中，成功回忆的次数除以总作答次数。它描述实际表现，与设置中的目标记住概率不同。</p><p>{snapshot.daily.reduce((n,d)=>n+d.reviews,0)?Math.round(100*snapshot.daily.reduce((n,d)=>n+d.successes,0)/snapshot.daily.reduce((n,d)=>n+d.reviews,0))+"%":"还没有足够数据"}</p></details></section>}
        {tab==="settings"&&settings&&<section className={styles.settings}><h2>让安排适合你的生活</h2><p>调整数量与记住概率，从下一次新建的每日计划起生效。已经学过的进度会保留。</p><label>每天新学几个词<input type="number" min="0" max="50" value={settings.newPerDay} onChange={e=>setSettings({...settings,newPerDay:Number(e.target.value)})}/><small>先从少量开始；复习积压较多时，系统暂不加入新词。</small></label><label>每天安排多少个到期词<input type="number" min="1" max="300" value={settings.reviewsPerDay} onChange={e=>setSettings({...settings,reviewsPerDay:Number(e.target.value)})}/><small>同一个词当天的必要巩固可能出现多次，不会算成多个词。</small></label><label>下次复习时，希望多大概率记得<select value={settings.retention} onChange={e=>setSettings({...settings,retention:Number(e.target.value)})}><option value={.85}>85% · 复习少一些</option><option value={.9}>90% · 均衡安排</option><option value={.95}>95% · 更频繁巩固</option></select><small>目标越高，需要复习得越勤。这个数不是你的考试分数。</small></label><label className={styles.check}><input type="checkbox" checked={settings.reminders} onChange={e=>setSettings({...settings,reminders:e.target.checked})}/>打开网站时提醒今日复习</label>{imported>0&&<label className={styles.check}><input type="checkbox" checked={settings.includeAnki} onChange={e=>setSettings({...settings,includeAnki:e.target.checked})}/>将已导入 Anki 的词从头开始站内学习（不会改动 Anki；原进度尚未迁移）</label>}<button className={styles.primary} disabled={busy} onClick={()=>void run(async()=>{accept(await api<StudySnapshot>({op:"settings",settings}));setMessage("学习安排已保存。");})}>保存安排</button>
          <div className={styles.pause}><h3>特殊情况，允许暂停</h3><p>暂停期间停止提醒和新计划。真实时间仍然经过，预计记住概率会自然降低；恢复后每天分批复习。</p><select aria-label="暂停时长" value={pauseDays} onChange={e=>setPauseDays(Number(e.target.value))}>{[1,3,7,14,30].map(d=><option key={d} value={d}>{d} 天</option>)}</select><button onClick={()=>setPauseConfirm(true)}>申请暂停</button>{pauseConfirm&&<PauseConfirmation busy={busy} onCancel={()=>setPauseConfirm(false)}><p>确实遇到特殊情况时再暂停。每天少量复习通常更容易维持；暂停不会清空待复习词，也不会人为扣除熟练度。</p><button disabled={busy} onClick={()=>void run(async()=>{accept(await api<StudySnapshot>({op:"pause",days:pauseDays}));setPauseConfirm(false);setTab("today");})}>确认暂停 {pauseDays} 天</button><button onClick={()=>setPauseConfirm(false)}>保持每日学习</button></PauseConfirmation>}</div>
          <details><summary>记忆安排依据</summary><p>使用 FSRS-6（ts-fsrs 5.4.2）及默认参数，每张卡根据真实作答分别更新。“不记得”和“模糊但错”记为遗忘；“模糊但对”记为费力回忆；“记得且对”记为正常回忆。当前尚未训练个人参数，完整复习历史会保留以供后续优化与迁移。</p></details>
        </section>}
        {tab==="profile"&&<section><h2>从真实阅读，认识自己的词汇</h2><p>只有查词次数还不够。我们结合有效阅读时间、遇到的词和复习表现，积累你的阅读画像。</p>{profile&&<><div className={styles.metrics}><div><strong>{Math.floor(profile.activeSeconds/60)}</strong><span>有效阅读分钟</span></div><div><strong>{profile.uniqueLookups}</strong><span>阅读中查过的不同表达</span></div></div><p className={styles.explain}>没有划词，不等于已经认识。画像提供阅读难度建议与薄弱点，不把这些观察伪装成精确词汇量测试。</p>{profile.result&&<><h3>{profile.result.recommendedLevel}</h3><p>{profile.result.summary}</p><h3>下一步重点</h3><ul>{profile.result.focus.map((v,i)=><li key={i}>{v}</li>)}</ul></>}{snapshot.policy.profileEnabled?<><p>至少积累 {snapshot.policy.minimumReadingMinutes} 分钟有效阅读与 {snapshot.policy.minimumLookups} 个不同表达后，可以主动生成。每次生成 {snapshot.policy.profileCost} 点，查看已生成结果不扣点。</p><button className={styles.primary} disabled={!profile.eligible||busy} onClick={()=>void generateProfile()}>生成阅读画像 · {snapshot.policy.profileCost} 点</button></>:<p className={styles.explain}>阅读证据正在积累。画像生成的扣点规则确认并开放后，会在这里明确展示，当前不会自动调用或扣费。</p>}</>}</section>}
        </>}
        {tab==="profile"&&profile?.result&&<button className={styles.primary} onClick={()=>{
          const current=readRecommendationPreferences();
          writeRecommendationPreferences({...current,readingLevel:profile.result!.recommendedLevel as RecommendationReadingLevel},{authenticated:true});
          onClose();
        }}>按建议难度推荐外刊 →</button>}
      </div>
    </div>
  </dialog>;
}
