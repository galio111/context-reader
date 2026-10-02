"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "@/components/AccountProvider";
import type { BillingPlan, BillingQuote } from "@/lib/billingStore";
import { PLAN_NAMES } from "@/lib/billingPolicy";
import s from "./BillingPage.module.css";
type Order = { id: string; planId: string; term: string; kind: string; status: string; amountFen: number; expiresAt: string; createdAt: string };
type Member = { plan_id: string; term: string; starts_at: string; ends_at: string };
const copy: Record<string, [string,string,string]> = {
 free: ["先读一篇，找到感觉", "体验语境查词、摘要与全文翻译，按自己的节奏开始。", "适合偶尔阅读与功能体验"],
 basic: ["把阅读变成日常", "适合每天 1–2 篇约 1,000 词外刊，或约 2–4 篇真题阅读。", "每日英语学习约 1 小时"],
 plus: ["多读一些，理解更深", "适合每天 2–3 篇约 1,000 词外刊，或约 4–6 篇真题阅读。", "每日英语学习约 2 小时"],
 max: ["给热爱阅读的你", "适合每天约 6 篇 1,000 词外刊，或约 8–12 篇真题阅读。", "每日英语学习约 3 小时以上"],
};
const money = (n: number) => (n / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const date = (v: string) => new Date(v).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
const statusName: Record<string,string> = { pending:"待支付",paid:"已支付",closed:"已关闭",review:"付款已收到，待处理退款",refunding:"退款处理中",refunded:"已退款" };
async function billingAction(body: object) {
 const r = await fetch("/api/billing", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body) });
 const d = await r.json(); if (!r.ok) throw new Error(d.error || "暂时无法完成操作。"); return d;
}
export function BillingPage({ onBack }: { onBack?: () => void }) {
 const { account, openLogin, refreshAccount, isOffline } = useAccount();
 const [plans,setPlans] = useState<BillingPlan[]>([]);
 const [term,setTerm] = useState<"month"|"year">("month");
 const [ready,setReady] = useState(false);
 const [member,setMember] = useState<Member|null>(null);
 const [orders,setOrders] = useState<Order[]>([]);
 const checkoutRef = useRef<HTMLElement>(null);
 const [quote,setQuote] = useState<BillingQuote|null>(null);
 const [order,setOrder] = useState<Order|null>(null);
 const [qr,setQr] = useState("");
 const [error,setError] = useState("");
 const [busy,setBusy] = useState(false);
 const load = useCallback(async () => {
  try {
   const r = await fetch("/api/billing" + (account.authenticated && !account.localOnly ? "?account=1" : ""),{cache:"no-store"});
   const d = await r.json(); if (!r.ok) throw new Error(d.error);
   setPlans(d.plans);setReady(d.paymentReady);setMember(d.membership || null);setOrders(d.orders || []);
  } catch { setError("套餐信息暂时无法加载，请重试。"); }
 },[account.authenticated,account.localOnly]);
 useEffect(()=>{ void load(); },[load]);
 useEffect(()=>{ if(quote) checkoutRef.current?.scrollIntoView({behavior:"smooth",block:"start"}); },[quote]);
 const activeMember = member && Date.parse(member.ends_at)>Date.now() ? member : null;
 async function choose(plan: BillingPlan, topup = false) {
  if (!account.authenticated) { openLogin("登录后可以选择套餐，已有阅读数据会保留。");return; }
  setBusy(true);setError("");setOrder(null);setQr("");
  try { const d=await billingAction({action:"quote",planId:plan.id,term:topup?"month":term,kind:topup?"topup":"membership"});setQuote(d.quote); }
  catch(e){setError(e instanceof Error?e.message:"无法读取订单。");} finally{setBusy(false);}
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
  <header className={s.nav}><Link href="/">Context Reader</Link><button type="button" onClick={onBack || (()=>window.location.assign("/?menu=account"))}>← 返回账号与用量</button></header>
  <div className={s.content}>
   <header className={s.heading}><p>为每天多读一点</p><h1>找到适合你的阅读节奏。</h1><p>外刊与真题，一份额度。月付或年付，均不自动续费。</p></header>
   <div className={s.switcher} aria-label="付款周期">{(["month","year"] as const).map(v=><button key={v} type="button" aria-pressed={term===v} onClick={()=>{setTerm(v);setQuote(null);setOrder(null);setQr("");}}>{v==="month"?"月付":"年付 · 更划算"}</button>)}</div>
   {error&&<p className={s.notice} role="alert">{error} <button type="button" onClick={()=>{setError("");void load();}}>刷新</button></p>}
   {!plans.length&&!error&&<p role="status">正在读取套餐…</p>}
   <div className={s.grid}>{plans.map(p=><article key={p.id} className={s.card} data-featured={p.id==="plus" || undefined}>
    <div className={s.cardTop}><h2>{p.name}</h2>{account.plan?.id===p.id&&<span>当前套餐</span>}</div>
    <p className={s.tagline}>{copy[p.id]?.[0]}</p>
    <p className={s.price}><strong>¥{money(term==="year"?p.annualFen:p.monthlyFen)}</strong><span> / {term==="year"?"年":"月"}</span></p>
    <p className={s.subPrice}>{term==="year"&&p.id!=="free"?`平均 ¥${money(p.annualFen/12)} / 月 · 一次付清`:"按需购买，随时决定是否继续"}</p>
    <p className={s.points}><strong>{p.points.toLocaleString()}</strong> 点 / 月</p>
    <button className={s.primary} type="button" disabled={busy || isOffline || p.id==="free" || account.plan?.id==="admin"} onClick={()=>void choose(p)}>{p.id==="free"?"免费使用":account.plan?.id===p.id?"继续使用此套餐":"选择 "+p.name}</button>
    <p className={s.description}>{copy[p.id]?.[1]}</p><p className={s.time}>{copy[p.id]?.[2]}</p>
    {p.id==="max"&&<p className={s.support}>也可以只是想支持开发者。谢谢你 (｡•̀ᴗ-)✧</p>}
   </article>)}</div>
   <p className={s.footnote}>阅读量与学习时长仅作选档参考，不是使用上限或承诺。实际消耗取决于查词、追问和翻译频率；外刊与真题可混合阅读，真题按单篇阅读材料估算，不按整套试卷。单纯阅读不扣点。</p>
   {activeMember?.term==="year"&&<section className={s.addon}><div><h2>这个月想多读一些？</h2><p>为当前年付套餐补充一份月度点数，有效期为购买日起一个会员月。原年付到期日和发放日保持不变。</p></div><button type="button" disabled={busy} onClick={()=>{const p=plans.find(p=>p.id===activeMember.plan_id);if(p)void choose(p,true);}}>购买补充点数</button></section>}
   {(quote||order)&&<section ref={checkoutRef} className={s.checkout} aria-label="确认购买">
    <h2>{order?.status==="paid"?"购买成功，可以继续阅读了":order&&order.status!=="pending"?statusName[order.status]:"确认你的选择"}</h2>
    {quote&&<><p>{PLAN_NAMES[quote.planId]} · {quote.kind==="topup"?"补充点数":quote.term==="year"?"年付":"月付"} · {quote.kind === "topup" ? "本次补充" : "每月"} {quote.points.toLocaleString()} 点</p><dl><div><dt>套餐价格</dt><dd>¥{money(quote.priceFen)}</dd></div><div><dt>未使用权益抵扣</dt><dd>− ¥{money(quote.creditFen)}</dd></div><div><dt>本次实付</dt><dd><strong>¥{money(quote.amountFen)}</strong></dd></div></dl>
    {!order&&<><p>{quote.kind === "topup" ? "付款成功即发放补充点数，有效期一个会员月，原年付周期保持不变。" : `付款成功即开始新的${quote.term === "year" ? "一年" : "一个月"}周期。原套餐本期普通额度结束；已购补充点数保留至各自到期。不自动续费。`}</p><button className={s.primary} type="button" disabled={busy||!ready||isOffline} onClick={()=>void pay()}>{ready?"确认并用微信支付":"微信支付尚未开放"}</button></>}</>}
    {order&&<><p>订单 {order.id}</p><p>{statusName[order.status]} · 实付 ¥{money(order.amountFen)}</p>{qr&&order.status==="pending"&&<><img className={s.qr} src={qr} width={240} height={240} alt="微信支付二维码" /><p>请用微信扫一扫付款。二维码有效至 {new Date(order.expiresAt).toLocaleTimeString("zh-CN")}。手机端可在电脑上打开本站扫码。</p></>}<button type="button" disabled={busy} onClick={()=>void check(order.id)}>查询支付状态</button></>}
   </section>}
   {!ready&&<p className={s.footnote}>微信支付正在准备中，当前可以查看套餐，暂不收款。</p>}
   <section className={s.rules}><div><h2>点数怎么使用？</h2><p>划词解释 1 点 · 单独查词 5 点 · 句子追问 5 点<br/>短摘要 2 点 · 全文翻译每 500 个英文词 10 点，不足 500 词按 500 词计。</p><p>首次领取精选文章的已有摘要或译文同样扣点。重看自己已有结果免费，失败不扣点。导入与单纯保存文章不扣点；生成或领取摘要另计。</p></div><div><h2>周期与升级</h2><p>年付按会员月发放，普通点数不结转。付费周期从购买日起计算；免费账号按北京时间自然月更新。</p><p>升级或重购开始新周期。抵扣按原实付权益价值 ×「剩余时间与剩余普通额度比例中的较小值」计算；年付未开始的月份一并抵扣。补充点数优先使用先到期的一份。</p><p>后台调整点数后，新购买和下一会员月使用新额度；已发放点数保留。</p></div></section>
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
