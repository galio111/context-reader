"use client";
import type { StudySnapshot } from "@/types/study";
import { shanghaiDay } from "@/lib/studyScheduler";
import styles from "./StudyPanel.module.css";
export function StudyRewards({snapshot,busy,onActivate}:{snapshot:StudySnapshot;busy:boolean;onActivate:(milestone:number)=>void}){
 const {policy,rewards,streak}=snapshot;
 if(!policy.rewardsEnabled&&!rewards.length)return null;
 const yesterday=shanghaiDay(new Date(Date.parse(snapshot.serverNow)-86400000));
 const current=streak.last_day&&streak.last_day>=yesterday?streak.current:0;
 return <details className={styles.rewardDetails}><summary>已连续学习 {current} 天 · 查看额度与会员奖励</summary>
  <p>先完成当天复习和新词学习。每个首次学完的新词奖励 {policy.pointsPerNew} 点，每天最多 {policy.dailyRewardCap} 点；普通复习不发新词奖励。点数到账后 {policy.rewardDays} 天内有效。</p>
  <p>每天完成全部计划，并至少学完 {policy.streakMinNew} 个此前未获奖励的新词，计为连续学习一天。按北京时间计算；暂停或缺一天会重新计天，已获得的奖励保留。最高连续 {streak.best} 天。</p>
  <div className={styles.rewardGrid}>{policy.milestones.map(m=>{
   const earned=rewards.find(r=>r.milestone===m.days);
   return <div key={m.days}><strong>{m.days} 天</strong><span>{m.points>0?m.points+" 点":null}{m.points>0&&m.plan?" + ":""}{m.plan?m.months+" 个月 "+m.plan.toUpperCase():null}</span><span>{earned?"已获得":"首次达成可得"}</span></div>;
  })}</div>
  <p>每档连续奖励每个账号领取一次。会员奖励永久保留待启用；同档会员可延长，不同档位需等现有会员到期后启用，避免覆盖正在使用的套餐。</p>
  {rewards.filter(r=>r.plan).map(r=><p key={r.milestone}>{r.months} 个月 {r.plan!.toUpperCase()} · {r.activated_at?"已启用，到期 "+new Date(r.ends_at!).toLocaleDateString("zh-CN"):<button disabled={busy} onClick={()=>onActivate(r.milestone)}>启用这份会员奖励</button>}</p>)}
 </details>;
}
