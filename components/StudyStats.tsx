"use client";
import { useState } from "react";
import { recallProbability, shanghaiDay } from "@/lib/studyScheduler";
import { studyForecast, studyHistoryDays } from "@/lib/studyPresentation";
import type { StudySnapshot } from "@/types/study";
import styles from "./StudyPanel.module.css";

export function studyTime(ms:number) { return ms<60000 ? Math.round(ms/1000)+" 秒" : (ms/60000).toFixed(1)+" 分钟"; }
export function StudyStats({snapshot}: {snapshot:StudySnapshot}) {
  const [metric,setMetric]=useState<"cards"|"time">("cards");
  const now = new Date(snapshot.serverNow), today = shanghaiDay(now);
  const days = studyHistoryDays(snapshot.daily,today,28);
  const calendar = studyHistoryDays(snapshot.daily,today,91);
  const current=days[27];
  const fresh=snapshot.cards.filter(c=>c.memory.state===0).length;
  const steady=snapshot.cards.filter(c=>c.memory.state===2&&c.memory.stability>=21&&(recallProbability(c.memory,now)??0)>=.9).length;
  const total=snapshot.cards.length,learning=total-fresh-steady;
  const attempts=snapshot.daily.reduce((n,d)=>n+d.reviews,0),success=snapshot.daily.reduce((n,d)=>n+d.successes,0);
  const values=days.map(d=>metric==="cards"?d.cards:d.active_ms/60000),max=Math.max(1,...values);
  const forecast=studyForecast(snapshot.cards,now,snapshot.settings.includeAnki), peak=Math.max(1,...forecast.map(d=>d.count));
  const overdue=snapshot.cards.filter(c=>c.memory.state!==0&&(!c.anki_pending||snapshot.settings.includeAnki)&&Date.parse(c.memory.due)<=now.getTime()).length;
  return <>
    <section className={styles.surface} aria-label="学习概览"><dl className={styles.metrics}><div><dt>今天学过</dt><dd>{current.cards}<small>词</small></dd></div><div><dt>今天作答</dt><dd>{current.reviews}<small>次</small></dd></div><div><dt>近期答对</dt><dd>{attempts?Math.round(success/attempts*100)+"%":"—"}</dd></div><div><dt>今天用时</dt><dd className={styles.timeValue}>{studyTime(current.active_ms)}</dd></div></dl>
      <div className={styles.sectionHead}><h2>学习趋势</h2><div className={styles.segmented} aria-label="趋势指标"><button aria-pressed={metric==="cards"} onClick={()=>setMetric("cards")}>词数</button><button aria-pressed={metric==="time"} onClick={()=>setMetric("time")}>时间</button></div></div>
      <div className={styles.chartBars} aria-label="最近 28 天学习记录">{days.map((d,i)=><div key={d.day} tabIndex={0} className={styles.chartBar} style={{height:Math.max(2,values[i]/max*100)+"%"}} aria-label={`${d.day}，${metric==="cards"?d.cards+" 词":studyTime(d.active_ms)}`} data-tip={`${d.day.slice(5)} · ${metric==="cards"?d.cards+" 词":studyTime(d.active_ms)}`}/>)}</div><div className={styles.chartLabels}><span>{days[0].day.slice(5)}</span><span>{days[14].day.slice(5)}</span><span>今天</span></div>
    </section>
    <div className={styles.chartGrid}><section className={styles.surface}><div className={styles.sectionHead}><h2>单词状态</h2><span>当前词库</span></div><div className={styles.distribution}><div className={styles.donut} role="img" aria-label={`共 ${total} 词，稳固 ${steady}，巩固 ${learning}，未学 ${fresh}`} style={{background:`conic-gradient(var(--study-accent) 0 ${total?steady/total*100:0}%, var(--study-chart) ${total?steady/total*100:0}% ${total?(steady+learning)/total*100:0}%, var(--study-line) ${total?(steady+learning)/total*100:0}% 100%)`}}><strong>{total}</strong></div><dl className={styles.legend}><div><dt><i/>较为稳固</dt><dd>{steady}</dd></div><div><dt><i data-tone="learning"/>正在巩固</dt><dd>{learning}</dd></div><div><dt><i data-tone="new"/>尚未学习</dt><dd>{fresh}</dd></div></dl></div></section>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>复习安排</h2><span>未来 7 天</span></div><svg className={styles.forecast} viewBox="0 0 330 150" role="img" aria-label={forecast.map(d=>`${d.day}，${d.count}词`).join("；")}><path d="M20 25H316M20 65H316M20 105H316" stroke="var(--study-line)" fill="none"/><polyline points={forecast.map((d,i)=>`${24+i*48},${110-d.count/peak*80}`).join(" ")} fill="none" stroke="var(--study-accent)" strokeWidth="2.5"/>{forecast.map((d,i)=><g key={d.day}><circle cx={24+i*48} cy={110-d.count/peak*80} r="3" fill="var(--study-surface)" stroke="var(--study-accent)" strokeWidth="2"/><text x={24+i*48} y={100-d.count/peak*80} textAnchor="middle">{d.count}</text><text x={24+i*48} y="141" textAnchor="middle">{i?d.day.slice(5):"明天"}</text></g>)}</svg><p className={styles.caption}>{overdue>0?`另有 ${overdue} 个已到期词。`:""}按当前排期预估，作答后会调整。</p></section></div>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>学习日历</h2><span>过去 13 周</span></div><div className={styles.heatmap}>{calendar.map(d=><span tabIndex={0} key={d.day} data-level={d.reviews===0?0:d.reviews<10?1:d.reviews<30?2:3} aria-label={`${d.day}，${d.cards} 词，${d.reviews} 次作答`} title={`${d.day} · ${d.cards} 词 · ${d.reviews} 次`}/>)}</div><div className={styles.chartLabels}><span>{calendar[0].day}</span><span>{today}</span></div></section>
    <details className={styles.explanation}><summary>这些数字如何计算？</summary><p>同一天重复练习一个词，词数只计一次。答对比例取最近 90 天的有效作答；用时只统计前台实际学习，查看原文、切到其他页面或长时间停留不计时。</p><p>“较为稳固”指已进入长期复习、记忆稳定性至少 21 天、当前预计记住概率至少 90%，仍然需要复习。</p><div className={styles.history}>{[...snapshot.daily].sort((a,b)=>b.day.localeCompare(a.day)).slice(0,14).map(d=><div key={d.day}><time>{d.day}</time><span>{d.cards} 词 · {d.reviews} 次</span><span>{studyTime(d.active_ms)}</span></div>)}</div></details>
  </>;
}
