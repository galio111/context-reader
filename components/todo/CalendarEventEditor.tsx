"use client";
import {useState,type FormEvent} from "react";
import {isCalendarEvent,type CalendarEvent} from "@/lib/privateTodoState";
import {dateLabel,firstEventDate,plusDays,weekStart} from "./planner-model";
import {EditorDialog} from "./TodoEditors";

import {lunarMonths,lunarDays} from "./lunar-calendar";

const week = [1,2,3,4,5,6,0];
const weekdayName = (n:number) => "周"+"日一二三四五六"[n];

export function CalendarEventEditor({day,original,initialTitle="",save,remove,close}:{
  day:string;original:CalendarEvent|null;initialTitle?:string;save:(event:CalendarEvent)=>Promise<void>;remove:()=>Promise<void>;close:()=>void
}) {
  const [draft,setDraft]=useState<CalendarEvent>(()=>original || {id:crypto.randomUUID(),title:initialTitle.slice(0,300),frequency:"once",
    startDate:day,endDate:"",weekdays:[new Date(day+"T12:00:00Z").getUTCDay()],monthDay:Number(day.slice(-2)),startTime:"",endTime:"",color:"#3671a2"});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
  const repeats=draft.frequency==="weekly" || draft.frequency==="monthly" || draft.frequency==="lunarYearly";
  const removeLabel=original && (original.frequency==="weekly" || original.frequency==="monthly" || original.frequency==="lunarYearly") ? "删除整组" : "删除事件";
  function change<K extends keyof CalendarEvent>(key:K,value:CalendarEvent[K]){setDraft(old=>({...old,[key]:value}));setError("")}
  async function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    const value={...draft,title:draft.title.trim()};
    if(!repeats)value.endDate="";
    if(value.frequency==="week" && value.startDate){value.startDate=weekStart(value.startDate);value.startTime="";value.endTime=""}
    if(value.frequency==="weekly" && !value.weekdays.length){setError("请选择至少一个星期几。");return}
    if(value.endTime && (!value.startTime || value.endTime<=value.startTime)){setError("结束时间须晚于当天的开始时间。");return}
    if(!isCalendarEvent(value)){setError("请检查事件名称和起止日期。");return}
    if(!firstEventDate(value)){setError("这段日期内没有符合重复规则的日子，请调整日期或重复规则。");return}
    setBusy(true);
    try{await save(value);close()}catch(e){setError((e as Error).message);setBusy(false)}
  }
  async function deleteSeries(){
    setBusy(true);try{await remove();close()}catch(e){setError((e as Error).message);setBusy(false)}
  }
  return <EditorDialog title={original?"编辑日历事件":"添加日历事件"} close={()=>{if(!busy)close()}}>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>事件名称<input autoFocus required maxLength={300} value={draft.title} placeholder="例如：考试、课程或组会" onChange={e=>change("title",e.target.value)}/></label>
      <label>事件类型<select value={draft.frequency} onChange={e=>{
        const frequency=e.target.value as CalendarEvent["frequency"];
        setDraft(old=>({...old,frequency,...(frequency==="lunarYearly" ? {lunarMonth:old.lunarMonth ?? 1,monthDay:Math.min(30,old.monthDay)} : {})}));setError("");
      }}><option value="once">单次事件</option><option value="week">某周待定</option><option value="weekly">每周固定</option><option value="monthly">每月固定</option><option value="lunarYearly">每年农历</option></select></label>
      {draft.frequency==="weekly" ? <div role="group" aria-label="每周重复日期" className="td-weekdays">{week.map(n=>
        <button key={n} type="button" aria-pressed={draft.weekdays.includes(n)} onClick={()=>change("weekdays",draft.weekdays.includes(n)?draft.weekdays.filter(d=>d!==n):[...draft.weekdays,n].sort())}>{weekdayName(n)}</button>)}</div>
        : draft.frequency==="monthly" && <label>每月几号<select value={draft.monthDay} onChange={e=>change("monthDay",Number(e.target.value))}>{Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1} 日</option>)}</select>{draft.monthDay>28 && <small>遇到没有这一天的月份会跳过。</small>}</label>}
      {draft.frequency==="lunarYearly" && <div className="td-fields">
        <label>农历月份<select value={draft.lunarMonth} onChange={e=>change("lunarMonth",Number(e.target.value))}>{lunarMonths.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label>
        <label>农历日期<select value={draft.monthDay} onChange={e=>change("monthDay",Number(e.target.value))}>{lunarDays.map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label>
      </div>}
      <div className="td-fields"><label>{draft.frequency==="once"?"事件日期":draft.frequency==="week"?"选择这一周（任选一天）":"开始日期"}<input type="date" required value={draft.startDate} onChange={e=>change("startDate",e.target.value)}/></label>
        {repeats && <label>结束日期（可选）<input type="date" min={draft.startDate} value={draft.endDate} onChange={e=>change("endDate",e.target.value)}/></label>}
        {draft.frequency!=="week" && <><label>开始时间（可选）<input type="time" value={draft.startTime} onChange={e=>setDraft(old=>({...old,startTime:e.target.value,endTime:e.target.value?old.endTime:""}))}/></label>
        <label>结束时间（可选）<input type="time" disabled={!draft.startTime} value={draft.endTime} onChange={e=>change("endTime",e.target.value)}/></label></>}</div>
      {draft.frequency==="week" && draft.startDate && <p>{dateLabel(weekStart(draft.startDate))}至{dateLabel(plusDays(weekStart(draft.startDate),6))}，具体日期待定。</p>}
      <label>日历颜色<input type="color" value={draft.color} onChange={e=>change("color",e.target.value)}/></label>
    </fieldset>{error && <p role="alert">{error}</p>}
    {confirmDelete ? <div><p>{removeLabel}「{original?.title}」后，它会从日历中移除。</p><div className="td-actions"><button type="button" disabled={busy} onClick={()=>void deleteSeries()}>确认{removeLabel}</button><button type="button" onClick={()=>setConfirmDelete(false)}>取消删除</button></div></div>
      : <div className="td-actions"><button className="td-primary" disabled={busy}>{busy?"保存中…":"保存事件"}</button>{original && <button type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}>{removeLabel}</button>}</div>}
    </form></EditorDialog>;
}
