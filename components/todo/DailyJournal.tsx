import {useEffect,useState} from "react";
import {isoDay,plusDays,type Entry,type TodoData} from "./planner-model";
import {journalCsvLines,journalHeader,journalRows,stamp,type JournalPlan} from "./day-journal";
import {traditionalFestival} from "./lunar-calendar";

async function readPlans(from:string,to:string,signal?:AbortSignal):Promise<JournalPlan[]> {
  const r=await fetch("/api/todo/journal?from="+from+"&to="+to,{cache:"no-store",signal});
  if(!r.ok)throw Error("日志未能加载，请重试。");
  return (await r.json()).plans;
}

export function JournalExport({state,today}:{state:TodoData;today:string}) {
  const [from,setFrom]=useState(today.slice(0,7)+"-01"),[to,setTo]=useState(today);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function download(){
    setBusy(true);setMessage("");
    try {
      const lines=[journalHeader.join(",")];
      for(let start=from;start<=to;){
        const end=plusDays(start,365)<to?plusDays(start,365):to, plans=await readPlans(start,end);
        let index=0;
        for(let day=start;day<=end;day=plusDays(day,1)){
          while(index+1<plans.length && plans[index+1].day<=day)index++;
          const data=day===today?state:{...state,...plans[index]};
          lines.push(...journalCsvLines(day,journalRows(data,day),day!==today && plans[index].day==="0001-01-01"));
        }
        start=plusDays(end,1);
      }
      const url=URL.createObjectURL(new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download="每日日志_"+from+"_"+to+".csv";a.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
  }
  return <details className="td-journal-export"><summary>导出日志</summary><form onSubmit={e=>{e.preventDefault();void download()}}>
    <label>从 <input type="date" required max={to||today} value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>至 <input type="date" required min={from} max={today} value={to} onChange={e=>setTo(e.target.value)}/></label>
    <button className="td-link" disabled={busy}>{busy?"正在导出…":"下载 CSV"}</button>
    {message && <p role="alert">{message}</p>}</form></details>;
}

export function DailyJournal({state,day,today,complete,restore}:{
  state:TodoData;day:string;today:string;complete:(entry:Entry,day:string)=>Promise<void>;
  restore:(key:string)=>Promise<void>;
}) {
  const [loaded,setLoaded]=useState<{day:string;plan?:JournalPlan;error?:string}>(),[attempt,retry]=useState(0);
  useEffect(()=>{
    if(day===today)return;
    const abort=new AbortController();
    readPlans(day,day,abort.signal).then(plans=>{if(!abort.signal.aborted)setLoaded({day,plan:plans[0]})})
      .catch((e:Error)=>{if(!abort.signal.aborted)setLoaded({day,error:e.message})});
    return ()=>abort.abort();
  },[day,today,attempt]);
  if(day!==today && (loaded?.day!==day || !loaded.plan))return loaded?.day===day && loaded.error ?
    <p role="alert">{loaded.error} <button className="td-link" onClick={()=>retry(n=>n+1)}>重试</button></p>:
    <p className="td-caption" role="status">正在读取当日日志…</p>;
  const data=day===today?state:{...state,...loaded!.plan!};
  const rows=journalRows(data,day), groups=[...new Set(rows.map(r=>r.group))];
  const festival=traditionalFestival(day);
  return <>{day!==today && loaded?.plan?.day==="0001-01-01" && <p className="td-caption">此日早于日志启用时间，内容由留存记录还原。</p>}{festival && <p className="td-caption">{festival}</p>}
    {groups.map(group=><section className="td-group" key={group}><h2>{group}</h2>{rows.filter(r=>r.group===group).map(r=>{
      if(r.kind==="事件")return <div className="td-row td-review-row" key={r.key}><div>
        <strong>{r.title}</strong>{r.when && <small>{r.when}</small>}
      </div></div>;
      const done=r.finished!==undefined;
      const action=()=>r.historyKey?restore(r.historyKey):complete(r.entry!,day);
      return <div className={"td-row"+(done?" td-checked":"")} key={r.key}>
        <button type="button" className="td-tick" role="checkbox" aria-checked={done}
          aria-label={(done?"撤销完成":"完成")+"「"+r.title+"」"} onClick={()=>void action()}>
          <svg viewBox="0 0 20 20" aria-hidden><path d="M4 10l4 4 8-9"/></svg></button>
        <div><strong>{r.title}</strong><small>{r.category && <span>{r.category}</span>}
          {[r.occ!==day?r.occ:"",r.when,done?(isoDay(r.finished!)<=day?"已完成":"已补勾")+" · "+stamp(r.finished!):""].filter(Boolean).join(" · ")}</small></div>
      </div>;
    })}</section>)}
    {!rows.length && <p className="td-empty">这一天没有待办或日程记录。</p>}
  </>;
}
