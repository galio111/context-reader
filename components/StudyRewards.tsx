"use client";
import type { StudySnapshot } from "@/types/study";
import { useState } from "react";
import { shanghaiDay } from "@/lib/studyScheduler";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";
export function StudyRewards({snapshot,busy,onActivate,onClaim}:{snapshot:StudySnapshot;busy:boolean;onActivate:(milestone:number)=>void;onClaim:(id:string)=>void}) {
  const [view,setView]=useState<"pending"|"claimed">("pending");
  const {policy,rewards,streak}=snapshot;
  const yesterday=shanghaiDay(new Date(Date.parse(snapshot.serverNow)-86400000));
  const current=streak.last_day&&streak.last_day>=yesterday?streak.current:0;
  return <>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>我的奖励</h2><div className={styles.segmented}><button aria-pressed={view==="pending"} onClick={()=>setView("pending")}>待领取</button><button aria-pressed={view==="claimed"} onClick={()=>setView("claimed")}>已领取</button></div></div>
      {(snapshot.claims??[]).filter(c=>view==="pending"?c.points>c.claimed_points||!c.claimed_at:Boolean(c.claimed_at)).map(c=><div className={styles.settingRow} key={c.id}><div><strong>{c.milestone?"连续 "+c.milestone+" 天":c.day+" · 新词奖励"}</strong><p>{view==="claimed"?c.claimed_points:c.points-c.claimed_points} 点{c.plan?" + "+c.months+" 个月 "+c.plan.toUpperCase():""}</p></div>{view==="pending"?<button className={styles.primary} disabled={busy} onClick={()=>onClaim(c.id)}>领取</button>:<span className={styles.caption}>已领取</span>}</div>)}
      {!(snapshot.claims??[]).some(c=>view==="pending"?c.points>c.claimed_points||!c.claimed_at:Boolean(c.claimed_at))&&<p className={styles.caption}>{view==="pending"?"还没有待领取的奖励。":"领取的奖励会保存在这里。"}</p>}
    </section>
    <section className={styles.surface}><div className={styles.rewardLead}><div><h2>每一天，都算数</h2><p>最高连续 {streak.best} 天</p></div><div className={styles.streak}>{current}<small>天</small></div></div>
      {policy.rewardsEnabled?<><p className={styles.rewardDaily}>新学每词 <strong>{policy.pointsPerNew} 点</strong> · 每天最高 {policy.dailyRewardCap} 点</p><p className={styles.caption}>完成当天复习后，学完新词即可领取。普通复习不重复奖励。</p><div className={styles.milestones}>{policy.milestones.map(m=>{
        const earned=rewards.find(r=>r.milestone===m.days);
        return <div key={m.days} data-earned={Boolean(earned)}><span className={styles.milestoneIcon}><StudyIcon name={earned?"check":"gift"}/></span><div><span>连续 {m.days} 天</span><small>{earned?"已获得":"首次达成"}</small></div><strong>{[m.points?m.points+" 点":"",m.plan?m.months+" 个月 "+m.plan.toUpperCase():""].filter(Boolean).join(" + ")}</strong></div>;
      })}</div></>:<p className={styles.caption}>学习奖励暂未开放，已获得的奖励仍然保留。</p>}
    </section>
    {rewards.some(r=>r.plan)&&<section className={styles.surface}><div className={styles.sectionHead}><h2>我的会员奖励</h2></div>{rewards.filter(r=>r.plan&&!(snapshot.claims??[]).some(c=>c.milestone===r.milestone&&!c.claimed_at)).map(r=><div className={styles.settingRow} key={r.milestone}><div><strong>{r.months} 个月 {r.plan!.toUpperCase()}</strong><p>{r.activated_at?"已启用 · 到期 "+new Date(r.ends_at!).toLocaleDateString("zh-CN"):"已为你保留，随时启用"}</p></div>{!r.activated_at&&<button className={styles.primary} disabled={busy} onClick={()=>onActivate(r.milestone)}>启用</button>}</div>)}</section>}
    <details className={styles.explanation}><summary>奖励规则</summary><p>每天完成安排的到期复习，并至少学完 {policy.streakMinNew} 个此前未获奖励的新词，计为连续学习一天。按北京时间计算；暂停或缺一天会重新计天，已获得的奖励保留。</p><p>每档连续奖励每个账号领取一次。学习额度到账后 {policy.rewardDays} 天有效；会员奖励永久保留待启用。同档会员可延长，不同档位需等当前会员到期后启用。</p></details>
  </>;
}
