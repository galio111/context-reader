import {dateLabel,plusDays} from "./planner-model";

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
