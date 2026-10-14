"use client";
import { useState } from "react";
import { shanghaiDay, studyDayEnd } from "@/lib/studyScheduler";
import { studyForecast, studyHistoryDays, studyWordState } from "@/lib/studyPresentation";
import type { StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";

export function studyTime(ms:number) { return ms<60000 ? Math.round(ms/1000)+" 秒" : (ms/60000).toFixed(1)+" 分钟"; }
export function StudyStats({snapshot}: {snapshot:StudySnapshot}) {
  const [range,setRange]=useState(30);
  const [tooltip,setTooltip]=useState<{text:string;x:number;y:number}|null>(null);
  const [metric,setMetric]=useState<"cards"|"time">("cards");
  const now = new Date(snapshot.serverNow), today = shanghaiDay(now);
  const days = studyHistoryDays(snapshot.daily,today,range);
  const calendar = studyHistoryDays(snapshot.daily,today,364);
  const current=days[days.length-1];
  const states=snapshot.cards.map(c=>studyWordState(c,now));
  const fresh=states.filter(s=>s==="new").length, learning=states.filter(s=>s==="learning").length;
  const steady=states.filter(s=>s==="steady").length, review=states.filter(s=>s==="review").length;
  const total=states.length;
  const recent=studyHistoryDays(snapshot.daily,today,90);
  const attempts=recent.reduce((n,d)=>n+d.reviews,0),success=recent.reduce((n,d)=>n+d.successes,0);
  const values=days.map(d=>metric==="cards"?d.cards:d.active_ms/60000),max=Math.max(1,...values);
  const todayNew=new Set(snapshot.today?.new_ids??[]),todayPlan=new Set(snapshot.today?.card_ids??[]);
  const completedReviews=snapshot.cards.filter(c=>todayPlan.has(c.id)&&!todayNew.has(c.id)&&c.memory.state===2&&c.memory.last_review&&shanghaiDay(new Date(c.memory.last_review))===today&&Date.parse(c.memory.due)>=studyDayEnd(now).getTime()).length;
  const forecast=studyForecast(snapshot.cards,now,snapshot.settings.includeAnki,snapshot.settings.reviewsPerDay,completedReviews,snapshot.settings.pausedUntil,snapshot.today?.card_ids), peak=Math.max(1,...forecast.map(d=>d.count));

  return <>
    <section className={styles.surface} aria-label="学习概览"><dl className={styles.metrics}><div><dt>今天新学</dt><dd>{current.new_cards??0}<small>词</small></dd></div><div><dt>今天复习</dt><dd>{current.review_cards??0}<small>词</small></dd></div><div><dt>正在背</dt><dd>{learning}<small>词</small></dd></div><div><dt>近期答对</dt><dd>{attempts?Math.round(success/attempts*100)+"%":"—"}</dd></div><div><dt>今天用时</dt><dd className={styles.timeValue}>{studyTime(current.active_ms)}</dd></div></dl>
      <div className={styles.sectionHead}><h2>学习趋势</h2><div className={styles.segmented} aria-label="趋势指标"><button aria-pressed={metric==="cards"} onClick={()=>setMetric("cards")}>词数</button><button aria-pressed={metric==="time"} onClick={()=>setMetric("time")}>时间</button></div></div>
      <div className={styles.trendToolbar}><div className={styles.segmented} aria-label="时间范围">{[[30,"一个月"],[90,"三个月"],[365,"一年"]].map(([n,label])=><button key={n} aria-pressed={range===n} onClick={()=>setRange(Number(n))}>{label}</button>)}</div>{metric==="cards"&&<div className={styles.trendLegend}><span><i/>新学</span><span><i/>复习</span><span><i data-tone="learning"/>正在背</span></div>}</div>
      <div className={styles.chartBars} aria-label={`最近 ${range} 天学习记录`} style={{gap:range>90?"1px":range>30?"3px":"6px"}}>{days.map((d,i)=>{const tip=`${d.day} · 新学 ${d.new_cards??0} · 复习 ${d.review_cards??0} · 正在背 ${d.learning_cards??0} · ${studyTime(d.active_ms)}`;return <button key={d.day} className={styles.trendBar} aria-label={tip} onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({text:tip,x:r.left+r.width/2,y:r.top});}} onMouseLeave={()=>setTooltip(null)} onFocus={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({text:tip,x:r.left+r.width/2,y:r.top});}} onBlur={()=>setTooltip(null)} style={{height:Math.max(1,values[i]/max*100)+"%"}}>{metric==="cards"?<><i style={{flex:d.review_cards??0}}/><i style={{flex:d.new_cards??0}}/><i data-tone="learning" style={{flex:d.learning_cards??0}}/></>:<i style={{flex:1}}/>}</button>;})}</div><div className={styles.chartLabels}><span>{days[0].day.slice(5)}</span><span>{days[Math.floor(range/2)].day.slice(5)}</span><span>今天</span></div>
    </section>
    <div className={styles.chartGrid}><section className={styles.surface}><div className={styles.sectionHead}><h2>单词状态</h2><span>当前词库</span></div><div className={styles.distribution}><div className={styles.donut} role="img" aria-label={`共 ${total} 词，稳固 ${steady}，巩固 ${review}，正在背 ${learning}，未学 ${fresh}`} style={{background:`conic-gradient(var(--study-accent) 0 ${total?steady/total*100:0}%, var(--study-chart) ${total?steady/total*100:0}% ${total?(steady+review)/total*100:0}%, var(--study-learning) ${total?(steady+review)/total*100:0}% ${total?(steady+review+learning)/total*100:0}%, var(--study-line) ${total?(steady+review+learning)/total*100:0}% 100%)`}}><strong>{total}</strong></div><dl className={styles.legend}><div><dt><i/>较为稳固</dt><dd>{steady}</dd></div><div><dt><i data-tone="review"/>正在巩固</dt><dd>{review}</dd></div><div><dt><i data-tone="learning"/>正在背</dt><dd>{learning}</dd></div><div><dt><i data-tone="new"/>尚未学习</dt><dd>{fresh}</dd></div></dl></div></section>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>复习安排</h2><span>今天起 7 天</span></div><svg className={styles.forecast} viewBox="0 0 330 150" role="img" aria-label={forecast.map(d=>`${d.day}，${d.count}词`).join("；")}><path d="M20 25H316M20 65H316M20 105H316" stroke="var(--study-line)" fill="none"/><polyline points={forecast.map((d,i)=>`${24+i*48},${110-d.count/peak*80}`).join(" ")} fill="none" stroke="var(--study-accent)" strokeWidth="2.5"/>{forecast.map((d,i)=><g key={d.day}><circle cx={24+i*48} cy={110-d.count/peak*80} r="3" fill="var(--study-surface)" stroke="var(--study-accent)" strokeWidth="2"/><text x={24+i*48} y={100-d.count/peak*80} textAnchor="middle">{d.count}</text><text x={24+i*48} y="141" textAnchor="middle">{i===0?"今天":i===1?"明天":d.day.slice(5)}</text></g>)}</svg><p className={styles.caption}>今天还需复习 {forecast[0].count} 个词。同一个词再次出现不重复计数。</p></section></div>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>学习日历</h2><span>过去一年</span></div><div className={styles.calendarScroll}><div className={styles.heatmap}>{calendar.map(d=>{const tip=`${d.day} · 新学 ${d.new_cards??0} · 复习 ${d.review_cards??0} · 正在背 ${d.learning_cards??0}`;return <button key={d.day} data-level={d.reviews===0?0:d.reviews<10?1:d.reviews<30?2:3} aria-label={tip} onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({text:tip,x:r.left+r.width/2,y:r.top});}} onMouseLeave={()=>setTooltip(null)} onFocus={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({text:tip,x:r.left+r.width/2,y:r.top});}} onBlur={()=>setTooltip(null)} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setTooltip({text:tip,x:r.left+r.width/2,y:r.top});}}/>;})}</div></div><div className={styles.chartLabels}><span>{calendar[0].day}</span><span>{today}</span></div></section>
    {tooltip&&<div role="tooltip" className={styles.chartTooltip} style={{left:Math.max(135,Math.min(tooltip.x,window.innerWidth-135)),top:Math.max(12,tooltip.y-42)}}>{tooltip.text}</div>}
  </>;
}
