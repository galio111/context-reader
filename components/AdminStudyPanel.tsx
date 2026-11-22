"use client";
import { useEffect,useState } from "react";
import { PERSONAL_STUDY_REWARDS } from "@/lib/studyPolicy";
import type { StudyPolicy } from "@/types/study";
export function AdminStudyPanel() {
 const [policy,setPolicy]=useState<StudyPolicy|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{void fetch("/api/admin/study").then(r=>r.json()).then(d=>{if(d.policy)setPolicy(d.policy);else setMessage(d.error);}).catch(()=>setMessage("复习配置暂时无法读取。"));},[]);
 const fields=[["profileCost","画像生成点数"],["minimumReadingMinutes","画像最低有效阅读分钟"],["minimumLookups","画像最低不同查词数"]] as const;
 return <section className="my-6 rounded-xl border border-slate-200 p-5">
  <h3 className="text-lg font-semibold">站内复习与阅读画像</h3>
  <p className="my-2 text-sm text-slate-600">每天复习 30 个不同的到期旧词记一次打卡。连续奖励每档发放一次，兑换由本人确认。</p>
  {message&&<p role="status">{message}</p>}
  {policy&&<>
   <div className="my-4 flex flex-wrap gap-5"><label><input type="checkbox" checked={policy.rewardsEnabled} onChange={e=>setPolicy({...policy,rewardsEnabled:e.target.checked})}/> 开启学习奖励</label><label><input type="checkbox" checked={policy.profileEnabled} onChange={e=>setPolicy({...policy,profileEnabled:e.target.checked})}/> 开启付费画像生成</label></div>
   <div className="grid gap-4 md:grid-cols-3">{fields.map(([key,label])=><label key={key} className="grid gap-2 text-sm">{label}<input className="rounded border p-2" type="number" value={policy[key]} onChange={e=>setPolicy({...policy,[key]:Number(e.target.value)})}/></label>)}</div>
   <h4 className="mb-3 mt-6 font-semibold">连续复习奖励</h4>
   <ul className="text-sm">{PERSONAL_STUDY_REWARDS.map(m=><li key={m.days}>{m.days} 天 · {m.label}</li>)}</ul>
   <button disabled={busy} className="ml-3 mt-4 rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={async()=>{setBusy(true);setMessage("正在保存…");try{const r=await fetch("/api/admin/study",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(policy)});const d=await r.json();if(!r.ok)throw new Error(d.error);setPolicy(d.policy);setMessage("复习规则已保存。");}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>保存复习规则</button>
  </>}
 </section>;
}
