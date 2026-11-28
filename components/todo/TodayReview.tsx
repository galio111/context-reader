import {useMemo} from "react";
import {dateLabel,dayReview,eventTime,plusDays,timing,type TodoData} from "./planner-model";
import {isSpringFestival} from "./lunar-calendar";

export function TodayHeading({day,today,select}:{day:string;today:string;select:(date:string)=>void}) {
  const past=day<today;
  const title=day===today?"今天":day===plusDays(today,-1)?"昨天":day===plusDays(today,-2)?"前天":dateLabel(day,today);
  return <div className="td-heading td-review-heading">
    <button className="td-step-day" aria-label="前一天" disabled={day==="0001-01-01"} onClick={()=>select(plusDays(day,-1))}>←</button>
    <h1>{title}</h1>
    {past && <button className="td-step-day" aria-label="后一天" onClick={()=>select(plusDays(day,1))}>→</button>}
    <input type="date" aria-label="选择回看日期" min="0001-01-01" max={today} value={day}
      onChange={e=>{if(e.currentTarget.value && e.currentTarget.validity.valid)select(e.currentTarget.value)}}/>
    <span>周{"日一二三四五六"[new Date(day+"T12:00:00Z").getUTCDay()]}</span>
    {past && <button className="td-link" onClick={()=>select(today)}>回到今天</button>}
  </div>;
}

export function PastDay({state,day}:{state:TodoData;day:string}) {
  const {groups,completed,events}=useMemo(()=>dayReview(state,day),[state,day]);
  return <>
    {isSpringFestival(day) && <p className="td-caption">春节 · 农历正月初一</p>}
    {events.length>0 && <section className="td-group"><h2>当日日程</h2>{events.map(event=>
      <div className="td-row td-review-row" key={event.id}><div><strong>{event.title}</strong><small>{eventTime(event)}</small></div></div>)}</section>}
    {groups.map(group=><section className="td-group" key={group.title}><h2>{group.title==="该动手了"?"当日到期或已到开工日":group.title}</h2>
      {group.rows.map(entry=><div key={entry.task.id} className="td-row td-review-row"><div><strong>{entry.task.title}</strong>
        <small>{entry.task.category && <span>{entry.task.category}</span>}{timing(entry,day)}</small></div></div>)}</section>)}
    {completed.length>0 && <section className="td-group"><h2>当日已完成 · {completed.length}</h2>{completed.map(h=>
      <div className="td-row td-past" key={h.key}><span className="td-history-check" aria-hidden>✓</span><div><strong>{h.title}</strong>
        <small>{h.category && <span>{h.category}</span>}{new Date(h.finished).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Asia/Shanghai"})} 勾选</small></div></div>)}</section>}
    {!groups.length && !completed.length && !events.length && <p className="td-empty">这一天没有待办或日程记录。</p>}
  </>;
}
