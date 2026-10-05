"use client";
import { useEffect,useState } from "react";
import type { StudyPolicy,StudyMilestone } from "@/types/study";
export function AdminStudyPanel() {
 const [policy,setPolicy]=useState<StudyPolicy|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{void fetch("/api/admin/study").then(r=>r.json()).then(d=>{if(d.policy)setPolicy(d.policy);else setMessage(d.error);}).catch(()=>setMessage("复习配置暂时无法读取。"));},[]);
 const fields=[["pointsPerNew","每个新词奖励点数"],["dailyRewardCap","每日新词奖励上限"],["rewardDays","奖励点数有效天数"],["streakMinNew","连续学习日最低新词数"],["profileCost","画像生成点数"],["minimumReadingMinutes","画像最低有效阅读分钟"],["minimumLookups","画像最低不同查词数"]] as const;
 const milestone=(i:number,patch:Partial<StudyMilestone>)=>{if(policy)setPolicy({...policy,milestones:policy.milestones.map((m,n)=>n===i?{...m,...patch}:m)});};
 return <section className="my-6 rounded-xl border border-slate-200 p-5">
  <h3 className="text-lg font-semibold">站内复习与阅读画像</h3>
  <p className="my-2 text-sm text-slate-600">固定先复习后学新词。每日奖励只计算首次完成的新词。连续奖励按北京时间、每个账号每档一次；修改只影响以后获得的奖励，已获得会员时长不被追溯修改。</p>
  {message&&<p role="status">{message}</p>}
  {policy&&<>
   <div className="my-4 flex flex-wrap gap-5"><label><input type="checkbox" checked={policy.rewardsEnabled} onChange={e=>setPolicy({...policy,rewardsEnabled:e.target.checked})}/> 开启学习奖励</label><label><input type="checkbox" checked={policy.profileEnabled} onChange={e=>setPolicy({...policy,profileEnabled:e.target.checked})}/> 开启付费画像生成</label></div>
   <div className="grid gap-4 md:grid-cols-3">{fields.map(([key,label])=><label key={key} className="grid gap-2 text-sm">{label}<input className="rounded border p-2" type="number" value={policy[key]} onChange={e=>setPolicy({...policy,[key]:Number(e.target.value)})}/></label>)}</div>
   <h4 className="mb-3 mt-6 font-semibold">连续学习奖励</h4>
   <div className="space-y-3">{policy.milestones.map((m,i)=><div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-5">
    <label className="grid gap-1 text-sm">连续天数<input aria-label={"第"+(i+1)+"档连续天数"} className="w-full rounded border p-2" type="number" min="1" value={m.days} onChange={e=>milestone(i,{days:Number(e.target.value)})}/></label>
    <label className="grid gap-1 text-sm">额外点数<input className="w-full rounded border p-2" type="number" min="0" value={m.points} onChange={e=>milestone(i,{points:Number(e.target.value)})}/></label>
    <label className="grid gap-1 text-sm">赠送会员<select className="rounded border p-2" value={m.plan??""} onChange={e=>milestone(i,{plan:(e.target.value||null) as StudyMilestone["plan"],months:e.target.value?Math.max(1,m.months):0})}><option value="">不赠送会员</option><option value="basic">Basic</option><option value="plus">Plus</option><option value="max">Max</option></select></label>
    <label className="grid gap-1 text-sm">赠送月数<input className="w-full rounded border p-2" type="number" disabled={!m.plan} min="0" max="24" value={m.months} onChange={e=>milestone(i,{months:Number(e.target.value)})}/></label>
    <button className="self-end rounded border px-3 py-2" onClick={()=>setPolicy({...policy,milestones:policy.milestones.filter((_,n)=>n!==i)})}>移除此档</button>
   </div>)}</div>
   <button className="my-4 rounded border px-4 py-2" disabled={policy.milestones.length>=24} onClick={()=>setPolicy({...policy,milestones:[...policy.milestones,{days:Math.max(0,...policy.milestones.map(m=>m.days))+1,points:0,plan:null,months:0}]})}>增加奖励档位</button>
   <button disabled={busy} className="ml-3 mt-4 rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={async()=>{setBusy(true);setMessage("正在保存…");try{const r=await fetch("/api/admin/study",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(policy)});const d=await r.json();if(!r.ok)throw new Error(d.error);setPolicy(d.policy);setMessage("复习规则已保存。");}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>保存复习规则</button>
  </>}
 </section>;
}
