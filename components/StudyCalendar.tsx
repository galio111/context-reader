"use client";
import { useState } from "react";
import { studyHistoryDays } from "@/lib/studyPresentation";
import type { StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";

function monthAt(month:string, offset:number) {
  const d=new Date(month+"-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth()+offset);
  return d.toISOString().slice(0,7);
}

export function StudyCalendar({daily,today}:{daily:StudySnapshot["daily"];today:string}) {
  const days=studyHistoryDays(daily,today,365);
  const latest=today.slice(0,7), earliest=days[0].day.slice(0,7);
  const [offset,setOffset]=useState(0), [selected,setSelected]=useState<string|null>(null);
  const month=monthAt(latest,offset);
  const currentDays=days.filter(d=>d.day.startsWith(month));
  const current=currentDays.find(d=>d.day===selected)??currentDays[currentDays.length-1];
  const level=(reviews:number)=>reviews===0?0:reviews<10?1:reviews<30?2:3;
  const description=(d:(typeof days)[number])=>d.day+" · 新学 "+(d.new_cards??0)+" · 复习 "+(d.review_cards??0)+" · 正在背 "+(d.learning_cards??0);
  const [hover,setHover]=useState<string|null>(null);
  return <section className={styles.surface+" "+styles.calendarSurface} aria-label="学习日历">
    <div className={styles.sectionHead}><h2>学习日历</h2><span className={styles.yearCalendar}>过去一年</span>
      <div className={styles.monthNav}><button aria-label="上个月" disabled={month<=earliest} onClick={()=>{setOffset(offset-1);setSelected(null);}}>‹</button>
      <span>{Number(month.slice(0,4))} 年 {Number(month.slice(5))} 月</span>
      <button aria-label="下个月" disabled={month>=latest} onClick={()=>{setOffset(offset+1);setSelected(null);}}>›</button></div>
    </div>
    <div className={styles.monthCalendar}>
      <div className={styles.monthGrid}>
        {["一","二","三","四","五","六","日"].map(s=><span aria-hidden="true" key={s}>{s}</span>)}
        {currentDays.map((d,i)=><button type="button" key={d.day} data-level={level(d.reviews)} aria-label={description(d)}
          aria-pressed={current?.day===d.day} aria-current={d.day===today?"date":undefined}
          style={i===0?{gridColumnStart:(new Date(d.day+"T00:00:00Z").getUTCDay()+6)%7+1}:undefined}
          onClick={()=>setSelected(d.day)}>{Number(d.day.slice(-2))}</button>)}
      </div>
      {current&&<p className={styles.caption} aria-live="polite">{description(current)}</p>}
    </div>
    <div className={styles.yearCalendar}>
      <div className={styles.calendarScroll} data-local-scroll-surface><div className={styles.heatmap}>{days.map(d=>
        <button key={d.day} data-level={level(d.reviews)} aria-label={description(d)} title={description(d)}
          onFocus={()=>setHover(d.day)} onMouseEnter={()=>setHover(d.day)} onBlur={()=>setHover(null)}
          onMouseLeave={()=>setHover(null)} onClick={()=>setHover(d.day)}/>)}</div></div>
      <div className={styles.chartLabels}><span>{days[0].day}</span><span>{today}</span></div>
      {hover&&<p className={styles.caption}>{description(days.find(d=>d.day===hover)??days[days.length-1])}</p>}
    </div>
  </section>;
}
