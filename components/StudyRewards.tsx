"use client";
import { useState } from "react";
import type { StudySnapshot, StudyVoucher, VoucherChoice } from "@/types/study";
import { shanghaiDay } from "@/lib/studyScheduler";
import { PERSONAL_STUDY_REWARDS } from "@/lib/studyPolicy";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

interface Props {
  snapshot: StudySnapshot; busy: boolean;
  onRedeem(voucher: StudyVoucher, choice?: VoucherChoice): void;
  onActivate(milestone: number): void; onClaim(id: string): void;
}
function voucherName(v: StudyVoucher) {
  if(v.milestone===365 && v.choice) return v.choice==="shoes"?"一双鞋":"一件衣服";
  if(v.milestone===180) return "一杯奶茶 · 第 "+v.unit+" 张";
  return PERSONAL_STUDY_REWARDS.find(m=>m.days===v.milestone)?.label;
}
function VoucherRow({voucher,busy,onRedeem}:Pick<Props,"busy"|"onRedeem">&{voucher:StudyVoucher}) {
  const [confirm,setConfirm]=useState(false);
  const [choice,setChoice]=useState<VoucherChoice>();
  return <div className={styles.settingRow}>
    <div><strong>{voucherName(voucher)}</strong><p>连续 {voucher.milestone} 天 · {voucher.earned_day} 获得</p></div>
    {voucher.redeemed_at?<span>{shanghaiDay(new Date(voucher.redeemed_at))} 已兑换</span>
      :confirm?<div className={styles.voucherActions}>
        {voucher.milestone===365&&<label>兑换物品 <select aria-label="兑换物品" value={choice??""} onChange={e=>setChoice(e.target.value as VoucherChoice)}>
          <option value="" disabled>请选择</option><option value="clothes">一件衣服</option><option value="shoes">一双鞋</option></select></label>}
        <button disabled={busy} onClick={()=>{setConfirm(false);setChoice(undefined);}}>取消</button>
        <button className={styles.primary} disabled={busy||(voucher.milestone===365&&!choice)} onClick={()=>onRedeem(voucher,choice)}>确认兑换</button></div>
      :<button className={styles.primary} disabled={busy} onClick={()=>setConfirm(true)}>兑换</button>}
  </div>;
}
export function StudyRewards({snapshot,busy,onActivate,onClaim,onRedeem}:Props) {
  const [redeemed,setRedeemed]=useState(false);
  const [legacyPending,setLegacyPending]=useState(true);
  const {rewards,streak}=snapshot;
  const vouchers=snapshot.vouchers??[], visible=vouchers.filter(v=>Boolean(v.redeemed_at)===redeemed);
  const today=shanghaiDay(new Date(snapshot.serverNow)), yesterday=shanghaiDay(new Date(Date.parse(snapshot.serverNow)-86400000));
  const current=streak.last_day&&streak.last_day>=yesterday?streak.current:0;
  const answers=snapshot.reviews.filter(r=>!r.undone && shanghaiDay(new Date(r.reviewed_at))===today);
  const introduced=new Set(answers.filter(r=>r.previous.state===0).map(r=>r.card_id));
  const reviewed=new Set(answers.filter(r=>r.previous.state===2&&!introduced.has(r.card_id)).map(r=>r.card_id)).size;
  return <>
    <section className={styles.surface}>
      <div className={styles.rewardLead}><div><h2>连续复习</h2><p>最长连续 {streak.best} 天</p></div><div className={styles.streak}>{current}<small>天</small></div></div>
      <p className={styles.rewardDaily}>{snapshot.today?.review_checkin?"今天已达标":"今日复习"} · <strong>{Math.min(reviewed,30)} / 30 词</strong></p>
      <p className={styles.caption}>每天复习 30 个不同的到期旧词算一天。答完转入「正在学」也计数，额外添加的复习量可自行安排。</p>
    </section>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>我的奖励券</h2>
      <div className={styles.segmented}><button aria-pressed={!redeemed} onClick={()=>setRedeemed(false)}>待兑换</button><button aria-pressed={redeemed} onClick={()=>setRedeemed(true)}>已兑换</button></div></div>
      {visible.map(v=><VoucherRow key={v.milestone+"-"+v.unit} voucher={v} busy={busy} onRedeem={onRedeem}/>)}
      {!visible.length&&<p className={styles.caption}>{redeemed?"还没有兑换记录。":"获得的奖励券会保存在这里，可随时兑换。"}</p>}
    </section>
    <section className={styles.surface}><div className={styles.sectionHead}><h2>连续天数奖励</h2></div>
      <p className={styles.caption}>{snapshot.policy.rewardsEnabled?"按北京时间连续打卡，每档首次达成时自动发券，长期有效。":"奖励发放已暂停，已获得的券仍可兑换。"}</p>
      <div className={styles.milestones}>{PERSONAL_STUDY_REWARDS.map(m=>{const earned=vouchers.some(v=>v.milestone===m.days);
        return <div key={m.days} data-earned={earned}><span className={styles.milestoneIcon}><StudyIcon name={earned?"check":"gift"}/></span>
          <div><span>连续 {m.days} 天</span>{earned&&<small>已获得</small>}</div><strong>{m.label}</strong></div>;})}</div>
    </section>
    {Boolean(snapshot.claims?.length)&&<details className={styles.explanation}><summary>历史学习奖励</summary>
      <div className={styles.segmented}><button aria-pressed={legacyPending} onClick={()=>setLegacyPending(true)}>待领取</button><button aria-pressed={!legacyPending} onClick={()=>setLegacyPending(false)}>已领取</button></div>
      {(snapshot.claims??[]).filter(c=>legacyPending?c.points>c.claimed_points||!c.claimed_at:Boolean(c.claimed_at)).map(c=><div className={styles.settingRow} key={c.id}><div><strong>{c.milestone?"连续 "+c.milestone+" 天":c.day+" · 新词奖励"}</strong><p>{!legacyPending?c.claimed_points:c.points-c.claimed_points} 点{c.plan?" + "+c.months+" 个月 "+c.plan.toUpperCase():""}</p></div>{legacyPending?<button className={styles.primary} disabled={busy} data-ui-target="study.claim" onClick={()=>onClaim(c.id)}>领取</button>:<span className={styles.caption}>已领取</span>}</div>)}
      {!(snapshot.claims??[]).some(c=>legacyPending?c.points>c.claimed_points||!c.claimed_at:Boolean(c.claimed_at))&&<p className={styles.caption}>{legacyPending?"还没有待领取的奖励。":"领取的奖励会保存在这里。"}</p>}
    </details>}
    {rewards.some(r=>r.plan)&&<section className={styles.surface}><div className={styles.sectionHead}><h2>我的会员奖励</h2></div>{rewards.filter(r=>r.plan&&!(snapshot.claims??[]).some(c=>c.milestone===r.milestone&&!c.claimed_at)).map(r=><div className={styles.settingRow} key={r.milestone}><div><strong>{r.months} 个月 {r.plan!.toUpperCase()}</strong><p>{r.activated_at?"已启用 · 到期 "+new Date(r.ends_at!).toLocaleDateString("zh-CN"):"已为你保留，随时启用"}</p></div>{!r.activated_at&&<button className={styles.primary} disabled={busy} data-ui-target="study.activate" onClick={()=>onActivate(r.milestone)}>启用</button>}</div>)}</section>}
  </>;
}
