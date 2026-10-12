"use client";
import Link from "next/link";
import { navigateExperiencePreview } from "@/lib/experiencePreview";
import { cachedPublicBilling, rememberPublicBilling } from "@/lib/billingClient";
import { LoadingStatus } from "./LoadingStatus";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "@/components/AccountProvider";
import type { BillingPlan, BillingQuote } from "@/lib/billingStore";
import { PLAN_NAMES } from "@/lib/billingPolicy";
import s from "./BillingPage.module.css";
type Order = { id: string; planId: string; term: string; kind: string; status: string; amountFen: number; expiresAt: string; createdAt: string };
type Member = { plan_id: string; term: string; starts_at: string; ends_at: string };
const copy: Record<string, [string,string,string,string]> = {
 basic: ["把阅读变成日常", "外刊 1–2 篇 / 天", "或真题阅读 2–4 篇 / 天", "约 1 小时学习"],
 plus: ["多读一些，理解更深", "外刊 2–3 篇 / 天", "或真题阅读 4–6 篇 / 天", "约 2 小时学习"],
 max: ["给热爱阅读的你", "外刊约 6 篇 / 天", "或真题阅读 8–12 篇 / 天", "约 3 小时以上学习"],
};
function Arrow({ back = false }: { back?: boolean }) {
 return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={back ? "M16 10H4m5-5-5 5 5 5" : "M4 10h12m-5-5 5 5-5 5"} /></svg>;
}
const money = (n: number) => (n / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const date = (v: string) => new Date(v).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
const statusName: Record<string,string> = { pending:"待支付",paid:"已支付",closed:"已关闭",review:"付款已收到，待处理退款",refunding:"退款处理中",refunded:"已退款" };
async function billingAction(body: object) {
 const r = await fetch("/api/billing", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body) });
 const d = await r.json(); if (!r.ok) throw new Error(d.error || "暂时无法完成操作。"); return d;
}
export function BillingPage({ onBack }: { onBack?: () => void }) {
 const { account, openLogin, refreshAccount, isOffline } = useAccount();
 const [plans,setPlans] = useState<BillingPlan[]>(()=>cachedPublicBilling()?.plans??[]);
 const [term,setTerm] = useState<"month"|"year">("month");
 const [ready,setReady] = useState(()=>cachedPublicBilling()?.paymentReady??false);
 const [member,setMember] = useState<Member|null>(null);
 const [orders,setOrders] = useState<Order[]>([]);
 const checkoutRef = useRef<HTMLElement>(null);
 const [quote,setQuote] = useState<BillingQuote|null>(null);
 const [order,setOrder] = useState<Order|null>(null);
 const [qr,setQr] = useState("");
 const [error,setError] = useState("");
 const [busy,setBusy] = useState(false);
 const [choosing,setChoosing] = useState<string|null>(null);
 const load = useCallback(async () => {
  try {
   const r = await fetch("/api/billing" + (account.authenticated && !account.localOnly ? "?account=1" : ""),{cache:"no-store"});
   const d = await r.json(); if (!r.ok) throw new Error(d.error);
   rememberPublicBilling(d);setError("");setPlans(d.plans);setReady(d.paymentReady);setMember(d.membership || null);setOrders(d.orders || []);
  } catch { setError("套餐信息暂时无法加载，请重试。"); }
 },[account.authenticated,account.localOnly]);
 useEffect(()=>{ void load(); },[load]);
 const orderId = order?.id;
 useEffect(()=>{
  if(!quote && !orderId)return;
  checkoutRef.current?.focus({preventScroll:true});
  checkoutRef.current?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});
 },[quote,orderId]);
 const activeMember = member && Date.parse(member.ends_at)>Date.now() ? member : null;
 const freePlan = plans.find(p=>p.id==="free");
 async function choose(plan: BillingPlan, topup = false) {
  if (!account.authenticated) { openLogin("登录后可以选择套餐，已有阅读数据会保留。");return; }
  setBusy(true);setChoosing(plan.id);setError("");setOrder(null);setQr("");
  try { const d=await billingAction({action:"quote",planId:plan.id,term:topup?"month":term,kind:topup?"topup":"membership"});setQuote(d.quote); }
  catch(e){setError(e instanceof Error?e.message:"无法读取订单。");} finally{setBusy(false);setChoosing(null);}
 }
 async function check(id: string) {
  try { const d=await billingAction({action:"check",orderId:id});setOrder(d.order); if(d.order.status!=="pending"){setQr("");await refreshAccount();await load();} }
  catch { setError("暂时无法确认支付状态，请稍后再次查询。请勿重复付款。"); }
 }
 useEffect(()=>{
  if(!order || order.status!=="pending")return;
  const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void check(order.id);},6000);
  return ()=>window.clearInterval(timer);
 // check deliberately reads the current order; interval is rebuilt after each result.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[order?.id,order?.status]);
 async function pay() {
  if(!quote)return;setBusy(true);setError("");
  try{
   const d=await billingAction({action:"create",...quote});setOrder(d.order);
   const QR=await import("qrcode");setQr(await QR.toDataURL(d.codeUrl,{width:240,margin:2,errorCorrectionLevel:"M"}));
  }catch(e){setError(e instanceof Error?e.message:"订单未完成。");}finally{setBusy(false);}
 }
 return <div className={s.page}>
  <header className={s.nav}><Link className={s.brand} href="/">Context Reader</Link><button className={s.back} type="button" onClick={onBack || (()=>{if(!navigateExperiencePreview("/?menu=account"))window.location.assign("/?menu=account");})}><Arrow back/>返回账号与用量</button></header>
  <div className={s.content}>
   <header className={s.heading}>
    <div><h1>选择适合你的阅读计划</h1><p>查词、翻译与摘要，共用一份月度点数。</p></div>
    <div className={s.period}><div className={s.switcher} data-term={term} role="group" aria-label="付款周期">{(["month","year"] as const).map(v=><button key={v} type="button" disabled={busy} aria-pressed={term===v} onClick={()=>{setTerm(v);setQuote(null);setOrder(null);setQr("");}}>{v==="month"?"月付":"年付"}</button>)}</div><p>按需购买 · 不自动续费</p></div>
   </header>
   {error&&<p className={s.notice} role="alert">{error} <button type="button" onClick={()=>{setError("");void load();}}>刷新</button></p>}
   {isOffline&&<p className={s.availability} role="status">当前处于离线模式，联网后可查看账号权益和选择套餐。</p>}
   {!plans.length&&!error&&<div className={s.loading}><LoadingStatus>正在读取套餐…</LoadingStatus></div>}
   <div className={s.grid}>{plans.filter(p=>p.id!=="free").map(p=><article key={p.id} className={s.card} aria-label={`${p.name} 套餐`} data-featured={p.id==="plus" || undefined}>
    <div className={s.cardTop}><h2>{p.name}</h2>{account.plan?.id===p.id&&<span className={s.current}>当前套餐</span>}</div>
    <p className={s.tagline}>{copy[p.id]?.[0]}</p>
    <p className={s.price}><span className={s.currency}>¥</span><strong>{money(term==="year"?p.annualFen:p.monthlyFen)}</strong><span> / {term==="year"?"年":"月"}</span></p>
    <p className={s.subPrice}>{term==="year"?<><span>平均 ¥{money(p.annualFen/12)} / 月，一次付清</span>{p.monthlyFen*12>p.annualFen&&<><br/><span className={s.saving}>比按月购买一年省 ¥{money(p.monthlyFen*12-p.annualFen)}</span></>}</>:"购买后开启一个月阅读计划"}</p>
    <p className={s.points}><span>每月额度</span><strong>{p.points.toLocaleString("zh-CN")}<small>点</small></strong></p>
    <button className={s.primary} type="button" disabled={busy || isOffline || account.plan?.id==="admin"} onClick={()=>void choose(p)}>{choosing===p.id?<LoadingStatus>正在读取费用…</LoadingStatus>:<>{account.plan?.id==="admin"?"开发者账号无需购买":account.plan?.id===p.id?"续用 "+p.name:ready?"选择 "+p.name:"查看 "+p.name}<Arrow/></>}</button>
    <div className={s.guide}><h3>阅读量参考</h3><p>{copy[p.id]?.[1]}</p><p>{copy[p.id]?.[2]}</p><p className={s.time}>{copy[p.id]?.[3]}</p></div>
    {p.id==="max"&&<p className={s.support}>也谢谢你对 Context Reader 的支持。</p>}
   </article>)}</div>
   {freePlan&&<section className={s.free} aria-label="免费账号"><div><div className={s.freeTitle}><h2>{freePlan.name}</h2>{account.plan?.id==="free"&&<span className={s.current}>当前套餐</span>}</div><p>¥0 · 先读一篇，找到感觉</p></div><div className={s.freePoints}><strong>{freePlan.points.toLocaleString("zh-CN")}</strong><span>点 / 月</span></div><button className={s.freeAction} type="button" onClick={()=>{if(!account.authenticated){openLogin("登录后即可免费体验，已有阅读数据会保留。");}else if(onBack){onBack();}else if(!navigateExperiencePreview("/")){window.location.assign("/");}}}>{account.authenticated?"返回阅读":"登录免费使用"}</button></section>}
   <p className={s.footnote}>以上为阅读量参考，外刊按约 1,000 词、真题按单篇材料估算，可混合使用。实际消耗取决于查词、追问和翻译频率，单纯阅读不扣点。</p>
   {!ready&&plans.length>0&&<p className={s.availability}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v5m0-8v1"/></svg>微信支付暂未开放，当前可查看套餐与费用。</p>}
   {activeMember?.term==="year"&&<section className={s.addon}><div><h2>这个月想多读一些？</h2><p>补充一份月度点数，有效期为购买日起一个会员月，原年付周期保持不变。</p></div><button className={s.freeAction} type="button" disabled={busy||isOffline} onClick={()=>{const p=plans.find(p=>p.id===activeMember.plan_id);if(p)void choose(p,true);}}>购买补充点数</button></section>}
   {(quote||order)&&<section ref={checkoutRef} tabIndex={-1} className={s.checkout} aria-label="确认购买">
    <h2>{order?.status==="paid"?"购买成功，可以继续阅读了":order&&order.status!=="pending"?statusName[order.status]:"确认你的选择"}</h2>
    {quote&&<><p>{PLAN_NAMES[quote.planId]} · {quote.kind==="topup"?"补充点数":quote.term==="year"?"年付":"月付"} · {quote.kind === "topup" ? "本次补充" : "每月"} {quote.points.toLocaleString()} 点</p><dl><div><dt>套餐价格</dt><dd>¥{money(quote.priceFen)}</dd></div><div><dt>未使用权益抵扣</dt><dd>− ¥{money(quote.creditFen)}</dd></div><div><dt>本次实付</dt><dd><strong>¥{money(quote.amountFen)}</strong></dd></div></dl>
    {!order&&<><p>{quote.kind === "topup" ? "付款成功即发放补充点数，有效期一个会员月，原年付周期保持不变。" : `付款成功即开始新的${quote.term === "year" ? "一年" : "一个月"}周期。原套餐本期普通额度结束；已购补充点数保留至各自到期。不自动续费。`}</p><button className={s.primary} type="button" disabled={busy||!ready||isOffline} onClick={()=>void pay()}>{busy?<LoadingStatus>正在创建订单…</LoadingStatus>:ready?"确认并用微信支付":"微信支付尚未开放"}</button></>}</>}
    {order&&<><p>订单 {order.id}</p><p>{statusName[order.status]} · 实付 ¥{money(order.amountFen)}</p>{qr&&order.status==="pending"&&<><img className={s.qr} src={qr} width={240} height={240} alt="微信支付二维码" /><p>请用微信扫一扫付款。二维码有效至 {new Date(order.expiresAt).toLocaleTimeString("zh-CN")}。手机端可在电脑上打开本站扫码。</p></>}<button type="button" disabled={busy} onClick={()=>void check(order.id)}>查询支付状态</button></>}
   </section>}
   <section className={s.rules} aria-label="套餐使用说明"><div className={s.rulesIntro}><h2>把点数用在需要的地方</h2><p>外刊与真题共用。已有的个人结果，可以免费重看。</p></div><div>
    <details open><summary>一次操作，会用多少点？</summary><div className={s.ruleBody}><dl className={s.costs}><div><dt>划词解释</dt><dd>1 点</dd></div><div><dt>单独查词</dt><dd>5 点</dd></div><div><dt>句子追问</dt><dd>5 点</dd></div><div><dt>短摘要</dt><dd>2 点</dd></div></dl><p>全文翻译每 500 个英文词 10 点，不足 500 词按 500 词计。</p><p>首次领取精选文章的已有摘要或译文同样扣点。重看自己的已有结果、失败、导入与单纯保存文章不扣点；生成或领取摘要另计。</p></div></details>
    <details><summary>月付和年付，点数如何更新？</summary><div className={s.ruleBody}><p>付费周期从购买日起计算，年付也按会员月发放点数，普通点数不结转。免费账号按北京时间自然月更新。</p><p>套餐额度调整后，新购买和下一会员月使用新额度，已发放点数保留。阅读量与学习时长仅作选档参考，不是使用上限或承诺。</p></div></details>
    <details><summary>升级、续购与补充点数</summary><div className={s.ruleBody}><p>升级或重购开始新周期。抵扣按原实付权益价值 ×「剩余时间与剩余普通额度比例中的较小值」计算，年付未开始的月份一并抵扣。确认购买前会显示本次实付。</p><p>年付账号可购买同档补充点数，有效期为购买日起一个会员月，原年付到期日和发放日保持不变。补充点数优先使用先到期的一份。</p></div></details>
   </div></section>
   {orders.length>0&&<section className={s.orders}><h2>最近订单</h2>{orders.map(o=><div key={o.id}><span>{date(o.createdAt)} · {PLAN_NAMES[o.planId]} {o.kind==="topup"?"补充点数":o.term==="year"?"年付":"月付"}</span><span>¥{money(o.amountFen)} · {statusName[o.status]}</span><button type="button" onClick={()=>{setQuote(null);setQr("");void check(o.id);}}>查看状态</button></div>)}</section>}
  </div>
 </div>;
}
export function BillingDialog({ onClose }: { onClose: () => void }) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const d=ref.current;const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  d?.showModal();
  return ()=>{d?.close();queueMicrotask(()=>{if(previous?.isConnected)previous.focus({preventScroll:true});});};
 },[]);
 return createPortal(<dialog ref={ref} className={s.dialog} onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"){e.preventDefault();onClose();}}} onCancel={e=>{e.preventDefault();e.stopPropagation();onClose();}} aria-label="升级账号"><BillingPage onBack={onClose}/></dialog>,document.body);
}
