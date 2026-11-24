"use client";
import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties} from "react";
import Link from "next/link";
import {calendarDays,defaultUrgentColor,urgencyLabel,dateLabel,dayEntries,isoDay,learnedCategory,nextMonth,occurrenceKey,plusDays,priorityLabels,taskGroups,timing,type Completed,type Entry,type Settings,type Task,type View} from "./planner-model";
import {InlineEditor,SettingsEditor} from "./TodoEditors";
import {useTodoStore} from "./useTodoStore";
import "./workspace.css";
import "../../public/todo-ui/capture-v2.css";

interface CaptureAPI {
  today:()=>string; categories:()=>string[]; getSettings:()=>Settings|undefined;
  addCategory:(name:string)=>Promise<void>; saveTasks:(items:Partial<Task>[])=>Promise<void>;
  suggestCategory:(text:string)=>{category:string;reason:string}|null;
  parseCapture:(text:string)=>Promise<unknown>;
}
declare global {interface Window {todoApp?:CaptureAPI; PrivateTodoCapture?:{mount:()=>void;destroy:()=>void}}}
const scripts = new Map<string, Promise<void>>();
function captureScript(src:string) {
  let result=scripts.get(src);
  if(!result) {
    result=new Promise<void>((resolve,reject)=>{
      const tag=document.createElement("script");tag.src=src;tag.onload=()=>resolve();
      tag.onerror=()=>{scripts.delete(src);tag.remove();reject(Error("录入工具暂时未能加载。"))};
      document.head.append(tag);
    });scripts.set(src,result);
  }
  return result;
}
const nav: [View,string][]=[["today","今天"],["upcoming","未来 24 小时"],["all","全部待办"],["history","完成历史"]];
const labels = Object.fromEntries(nav);
const clock = new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Asia/Shanghai"});
type Notice={text:string; undo?:string};
function CategoryAdd({category,ready}:{category:string;ready:boolean}) {
  const [open,setOpen]=useState(false),[draft,setDraft]=useState("");
  const addButton=useRef<HTMLButtonElement>(null);
  const name=category || "未分类";
  return <><button type="button" ref={addButton} className="td-group-add" aria-label={"在"+name+"添加待办"} aria-expanded={open} onClick={()=>setOpen(!open)} disabled={!ready}>＋</button>
    {open && <form className="td-category-input" onSubmit={e=>{
      e.preventDefault();
      if (!draft.trim()) return;
      document.getElementById("quick-form")?.dispatchEvent(new CustomEvent("todo-category-add",{detail:{text:draft,category,returnFocus:()=>addButton.current,onSaved:()=>{setDraft("");setOpen(false)}}}));
    }}><input autoFocus aria-label={name+"的新待办"} placeholder="输入待办…" maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter" && (e.nativeEvent.isComposing || e.nativeEvent.keyCode===229))e.preventDefault();if(e.key==="Escape"){setOpen(false);addButton.current?.focus()}}}/><button type="submit" disabled={!draft.trim()}>记下</button></form>}
  </>;
}
export default function PrivateTodoWorkspace() {
  const {snapshot,current,mutate,error,refresh} = useTodoStore();
  const state=snapshot?.state, ready=!!state;
  const [now,setNow]=useState(Date.now);
  const today=isoDay(now);
  const [view,setView]=useState<View>("today"),[selected,setSelected]=useState(today),[month,setMonth]=useState(today.slice(0,7));
  const [categoryFilter,setCategoryFilter]=useState("");
  useEffect(()=>{if(new URLSearchParams(location.search).get("view")==="all") setView("all")},[]);
  const [hoverDay,setHoverDay]=useState(""),[editing,setEditing]=useState<{key:string;original:Task}|null>(null);
  const [settingsBase,setSettingsBase]=useState<Settings|null>(null),[notice,setNotice]=useState<Notice|null>(null);
  const [settling,setSettling]=useState<string[]>([]),[captureReady,setCaptureReady]=useState(false),[captureIssue,setCaptureIssue]=useState("");
  const agenda=useRef<HTMLElement>(null), input=useRef<HTMLTextAreaElement>(null);
  const busy=useRef(new Set<string>());
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),15000);const tick=()=>setNow(Date.now());window.addEventListener("focus",tick);return ()=>{clearInterval(id);window.removeEventListener("focus",tick)}},[]);
  useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(null),notice.undo?8000:6000);return()=>clearTimeout(id)},[notice]);
  useEffect(()=>{
    if(!ready)return;
    let active=true;
    const api:CaptureAPI={
      today:()=>isoDay(), categories:()=>current.current?.state.categories||[], getSettings:()=>current.current?.state.settings,
      suggestCategory:text=>current.current?learnedCategory(text,current.current.state):null,
      addCategory:async(name)=>{const c=name.trim();if(!c)return;await mutate(s=>s.categories.includes(c)?s:{...s,categories:[...s.categories,c]})},
      saveTasks:async(items)=>{
        const added:Task[]=items.map(item=>({id:item.id || crypto.randomUUID(),title:(item.title||"").trim(),category:item.category||"",date:item.date||"",time:item.time||"",lead:item.lead||0,daily:!!item.daily,missed:item.missed||current.current?.state.settings.defaultMissed||"skip",priority:item.priority||"",color:item.color,created:isoDay()}));
        await mutate(s=>{
          const fresh=added.filter(t=>!s.tasks.some(old=>old.id===t.id));
          return fresh.length?{...s,tasks:[...s.tasks,...fresh],categories:[...new Set([...s.categories,...fresh.map(t=>t.category).filter(Boolean)])]}:s;
        });
        setNotice({text:"已记下 "+added.length+" 项待办"});
      },
      parseCapture:async(text)=>{
        const r=await fetch("/api/todo/parse",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
        if(!r.ok)throw Error("AI 暂时不可用，仍可手动确认。");
        return await r.json();
      }
    };
    window.todoApp=api;
    void (async()=>{
      try {
        await captureScript("/todo-ui/capture-parser.js?v=1124a");await captureScript("/todo-ui/capture-v2.js?v=1124c");
        if(active){if(!window.PrivateTodoCapture)throw Error();window.PrivateTodoCapture.mount();setCaptureReady(true)}
      }catch{if(active)setCaptureIssue("录入工具加载失败，请刷新后重试。")}
    })();
    return ()=>{active=false;if(window.todoApp===api){window.PrivateTodoCapture?.destroy();delete window.todoApp}};
  },[ready,current,mutate]);
  const displayState=useMemo(()=>state && (settling.length?{...state,history:state.history.filter(h=>!settling.includes(h.key))}:state),[state,settling]);
  const groups=useMemo(()=>{
    if(!displayState)return [];
    const grouped=taskGroups(displayState,view,today,selected,now);
    return view==="all" && categoryFilter ? grouped.filter(group=>group.category===categoryFilter) : grouped;
  },[displayState,view,today,selected,now,categoryFilter]);
  const history=useMemo(()=>[...(displayState?.history||[])].sort((a,b)=>b.finished-a.finished),[displayState]);
  const historyDates=useMemo(()=>{const days=new Map<string,Completed[]>();for(const h of history){const d=h.importedWithoutCompletionDate?"完成日期未记录":isoDay(h.finished);if(!days.has(d))days.set(d,[]);days.get(d)!.push(h)}return days},[history]);
  const doneKeys=useMemo(()=>new Set(history.map(h=>h.key)),[history]);
  const nextDue=useMemo(()=>(state?.tasks||[]).filter(t=>!t.daily&&t.date>today&&plusDays(t.date,-t.lead)>today&&!doneKeys.has(occurrenceKey(t,t.date))).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||"24:00").localeCompare(b.time||"24:00"))[0],[state?.tasks,today,doneKeys]);
  const undated=state?.tasks.filter(t=>!t.daily&&!t.date&&!doneKeys.has(occurrenceKey(t,""))).length||0;
  const cells=useMemo(()=>calendarDays(month),[month]);
  const contents=useMemo(()=>new Map(cells.map(day=>{
    const high=(e:Entry)=>Number(e.task.priority==="high" && !doneKeys.has(occurrenceKey(e.task,day)));
    const entries=dayEntries(state?.tasks||[],day).sort((a,b)=>high(b)-high(a)||(a.task.time||"").localeCompare(b.task.time||""));
    return [day,entries] as const;
  })),[state?.tasks,cells,doneKeys]);
  const monthHasHigh=[...contents.values()].some(rows=>rows.some(e=>e.task.priority==="high"&&!doneKeys.has(occurrenceKey(e.task,e.occ))));
  function jump(day:string) {setSelected(day);setMonth(day.slice(0,7));setView("day");setEditing(null);if(window.innerWidth<950)agenda.current?.scrollIntoView({block:"start"})}
  const restore=useCallback(async(key:string)=>{
    try{await mutate(s=>({...s,history:s.history.filter(h=>h.key!==key)}));setNotice({text:"已恢复到待办清单"})}
    catch(e){setNotice({text:(e as Error).message})}
  },[mutate]);
  async function complete(entry:Entry) {
    const {task,occ}=entry, key=occurrenceKey(task,occ);
    if(busy.current.has(key))return;
    busy.current.add(key);setSettling(old=>[...old,key]);
    const finished=Date.now();
    const record:Completed={key,taskId:task.id,occ:occ||isoDay(finished),title:task.title,category:task.category,daily:task.daily,finished};
    try {
      await Promise.all([mutate(s=>{
        if(s.history.some(h=>h.key===key))return s;
        const authoritative=s.tasks.find(t=>t.id===task.id);
        if(!authoritative || authoritative.daily!==task.daily)throw Error("这项待办已在其他设备更新，请重新确认。");
        return {...s,history:[{...record,title:authoritative.title,category:authoritative.category},...s.history]};
      }),new Promise(resolve=>setTimeout(resolve,matchMedia("(prefers-reduced-motion: reduce)").matches?0:420))]);
      setNotice({text:"已完成「"+task.title+"」",undo:key});
    }catch(e){setNotice({text:(e as Error).message})}
    finally{busy.current.delete(key);setSettling(old=>old.filter(k=>k!==key))}
  }
  const renderHistory=(records:Completed[])=>records.map(h=><div className="td-row td-past" key={h.key}>
    <span className="td-history-check" aria-hidden>✓</span><div><strong>{h.title}</strong><small>{[h.category,h.importedWithoutCompletionDate?"从备忘录导入":clock.format(h.finished)+" 勾选",h.daily?dateLabel(h.occ)+"的每日任务":""].filter(Boolean).join(" · ")}</small></div>
    <button className="td-link" onClick={()=>void restore(h.key)}>恢复</button></div>);
  function renderRow(entry:Entry) {
    const {task,occ}=entry,key=occurrenceKey(task,occ);
    if(editing?.key===key) return <InlineEditor key={key} task={editing.original} categories={state!.categories} cancel={()=>setEditing(null)} save={async(next)=>{
      await mutate(s=>{
        const original=s.tasks.find(t=>t.id===task.id);
        if(!original||[...new Set([...Object.keys(editing.original),...Object.keys(original)])].some(k=>JSON.stringify(original[k as keyof Task])!==JSON.stringify(editing.original[k as keyof Task])))throw Error("这项待办在其他设备已修改，取消编辑后可查看最新内容。");
        return {...s,tasks:s.tasks.map(t=>t.id===task.id?next:t)};
      });setEditing(null);setNotice({text:"已保存修改"});
    }}/>;
    const done=settling.includes(key);
    const urgent=urgencyLabel(task,today,now);
    const color=done ? undefined : task.color || (urgent ? state?.settings.urgentColor || defaultUrgentColor : undefined);
    return <div key={key} style={color ? {"--td-mark":color} as CSSProperties : undefined} className={"td-row"+(color?" td-marked":"")+(done?" td-checked":"")}>
      <button type="button" className="td-tick" role="checkbox" aria-label={"完成「"+task.title+"」"} aria-checked={done} disabled={done||(task.daily&&occ>today)} onClick={()=>void complete(entry)}><svg viewBox="0 0 20 20" aria-hidden><path d="M4 10l4 4 8-9" pathLength="1"/></svg></button>
      <div><strong>{task.title}</strong><small>{urgent && <b className="td-urgency">{urgent}</b>}{task.category && <span>{task.category}</span>}{timing(entry,today)}{task.priority && urgent!=="高优先级" && " · "+priorityLabels[task.priority]+"优先级"}</small></div>
      <button className="td-link" aria-label={"编辑「"+task.title+"」"} onClick={()=>setEditing({key,original:task})}>编辑</button></div>;
  }
  return <main className="td-app" style={{"--td-urgent":state?.settings.urgentColor || defaultUrgentColor} as CSSProperties}>
    <header className="td-top"><div><span className="td-brand">Context Reader</span><span className="td-separator">/</span><b>私人待办</b></div><Link href="/" prefetch={false}>返回阅读站 ↗</Link></header>
    {error && <p role="alert" className="td-error">{error} <button onClick={()=>snapshot?void refresh():location.reload()}>重新连接</button></p>}
    {!ready ? <p className="td-loading" role="status">{error?"暂时无法打开清单。":"正在打开你的清单…"}</p> : <div className="td-grid" data-view={view}>
      <aside className="td-rail">
        <form id="quick-form" className="td-capture" onSubmit={e=>e.preventDefault()}>
          <label htmlFor="task-input">随手记</label><textarea ref={input} id="task-input" rows={1} maxLength={4000} placeholder="随手记…" disabled={!captureReady}/>
          <div className="td-capture-foot"><button type="submit" disabled={!captureReady} aria-label="整理待办">记下 ↵</button></div>
          <div id="record-status" role="status"/>{captureIssue && <p role="alert">{captureIssue}</p>}
        </form>
        <nav aria-label="清单范围">{nav.map(([value,title])=><button key={value} aria-current={view===value?"page":undefined} onClick={()=>{setView(value);setEditing(null)}}>{title}</button>)}</nav>
        <button className="td-settings" onClick={()=>setSettingsBase(state!.settings)}>待办设置</button>
      </aside>
      <section className="td-agenda" ref={agenda}>
        <div className="td-heading"><h1>{view==="day"?dateLabel(selected)+"的待办":labels[view]}</h1>{view==="today"&&<span>{dateLabel(today)} · {"周"+"日一二三四五六"[new Date(today+"T12:00:00Z").getUTCDay()]}</span>}</div>
        {view==="all" && <label className="td-filter">分类<select value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setEditing(null)}}><option value="">所有分类</option>{state!.categories.map(c=><option key={c}>{c}</option>)}</select></label>}
        {view==="upcoming" && <p className="td-caption">接下来 24 小时内截止，全天事项按当天结束计算。</p>}
        {view==="history"?historyDates.size?[...historyDates].map(([day,records])=><section key={day} className="td-group"><h2>{day}</h2>{renderHistory(records)}</section>):<p className="td-empty">勾选完成的待办会按日期留在这里。</p>:
          groups.length?groups.map(group=><section key={group.category===undefined ? group.title : "category:"+group.category} className="td-group"><div className="td-group-head"><h2>{group.title}</h2>{group.category!==undefined && <CategoryAdd key={group.category} category={group.category} ready={captureReady}/>}</div>{group.rows.map(renderRow)}</section>):
          <p className="td-empty">{view==="today"?"今天还没有要开工、到期或例行的待办。":view==="day"?"这一天没有待完成的事项。":"这个范围内没有待完成的事项。"}</p>}
        {view==="today" && <>
          {nextDue && <button className="td-next" onClick={()=>jump(nextDue.date)}><span>下一项截止 · {dateLabel(nextDue.date)}{nextDue.time&&" "+nextDue.time}</span><b>{nextDue.title}</b></button>}
          {!!undated && <button className="td-link td-undated" onClick={()=>{setCategoryFilter("");setView("all")}}>另有 {undated} 项未定日期，查看全部待办 ↗</button>}
          <details className="td-done"><summary>今日已完成 · {historyDates.get(today)?.length||0}</summary>{renderHistory(historyDates.get(today)||[])}</details></>}
        {view==="day" && <button className="td-link" onClick={()=>setView("today")}>返回今天</button>}
      </section>
      <section className="td-calendar" aria-label="月历"><div className="td-calendar-head"><h2>{month.slice(0,4)} 年 {Number(month.slice(5))} 月</h2>
        <div><button aria-label="上个月" onClick={()=>{setMonth(nextMonth(month,-1));setHoverDay("")}}>‹</button><button onClick={()=>{setMonth(today.slice(0,7));setSelected(today);setView("today");setHoverDay("")}}>今</button><button aria-label="下个月" onClick={()=>{setMonth(nextMonth(month,1));setHoverDay("")}}>›</button></div></div>
        <div className="td-month">{[..."一二三四五六日"].map(d=><span className="td-week" key={d}>{d}</span>)}{cells.map(d=>{
          const rows=contents.get(d)||[];
          const highCount=rows.filter(e=>e.task.priority==="high"&&!doneKeys.has(occurrenceKey(e.task,d))).length;
          return <button key={d} className={"td-cell "+(d===today?"td-cell-today ":"")+(d===selected&&view==="day"?"td-selected ":"")+(d.slice(0,7)!==month?"td-other ":"")+(highCount?"td-has-high":"")} onClick={()=>jump(d)} onFocus={()=>setHoverDay(d)} onMouseEnter={()=>setHoverDay(d)} aria-label={dateLabel(d)+"，"+rows.length+"项待办"+(highCount?"，其中"+highCount+"项高优先级":"")}>
            <b>{Number(d.slice(-2))}</b>{rows.slice(0,2).map(({task})=>{
              const done=doneKeys.has(occurrenceKey(task,d)),high=task.priority==="high"&&!done;
              const mark=done ? undefined : task.color || (urgencyLabel(task,today,now) ? "var(--td-urgent)" : undefined);
              return <span style={mark ? {"--td-mark":mark} as CSSProperties : undefined} data-marked={mark ? true : undefined} className={done?"td-cell-done":high?"td-priority-high":""} key={task.id} title={[task.title,task.time||"全天"].join(" · ")}>{high?"↑ ":""}{task.title}</span>
            })}{rows.length>2 && <i>+{rows.length-2}</i>}</button>;
        })}</div>
        {monthHasHigh && <p className="td-legend"><span className="td-priority-high">↑ 高优先级</span></p>}
        {hoverDay && contents.has(hoverDay) && <div className="td-day-preview"><b>{dateLabel(hoverDay)}</b>{(contents.get(hoverDay)||[]).map(({task})=>{
          const done=doneKeys.has(occurrenceKey(task,hoverDay));
          return <p key={task.id}>{task.priority==="high"&&!done&&<span className="td-priority-high">↑ 高优先级</span>}{done?"✓ ":""}{task.time||"全天"}　{task.title}</p>
        })}{!contents.get(hoverDay)?.length&&<p>这天暂时空着。</p>}</div>}
      </section>
      <button className="td-mobile-add" onClick={()=>{input.current?.scrollIntoView({block:"center"});input.current?.focus()}}>＋ 随手记</button>
      <dialog id="capture-dialog" aria-label="确认待办"/>
      {settingsBase && <SettingsEditor settings={settingsBase} categories={state!.categories} close={()=>setSettingsBase(null)} onSave={async(next,names)=>{
        await mutate(s=>{
          if([...new Set([...Object.keys(settingsBase),...Object.keys(s.settings)])].some(k=>s.settings[k as keyof Settings]!==settingsBase[k as keyof Settings]))throw Error("设置已在另一处更新，请重新打开设置确认。");
          return {...s,settings:next,categories:[...new Set([...s.categories,...names])]};});
        setNotice({text:"设置已保存"});
      }}/>}
    </div>}
    {notice && <div className="td-notice" role="status"><span>{notice.text}</span>{notice.undo&&<button onClick={()=>void restore(notice.undo!)}>撤销</button>}</div>}
  </main>;
}
