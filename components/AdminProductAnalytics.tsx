"use client";
import { useEffect, useState } from "react";
import { LoadingStatus } from "./LoadingStatus";
import styles from "./AdminUsageReport.module.css";
interface Report {
  since: string; activeUsers: number; readers: number; firstPayments: number; completePayments: number; medianSecondsBeforePayment: number | null;
  retention: Array<{ day: number; eligible: number; returned: number }>;
  daily: Array<{ day: string; active: number; registrations: number; seconds: number }>;
  paymentBuckets: { under30: number; "30to120": number; over120: number };
}
export function AdminProductAnalytics() {
  const [days,setDays]=useState(30),[retry,setRetry]=useState(0),[data,setData]=useState<Report|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController(); setError(""); setData(null);
    void fetch(`/api/admin/product-analytics?days=${days}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();setData(await r.json());})
      .catch(()=>{if(!controller.signal.aborted)setError("学习统计暂时无法读取。");});
    return()=>controller.abort();
  },[days,retry]);
  return <section className={styles.section} aria-label="使用与留存">
    <div className="flex flex-wrap items-center justify-between gap-4"><h3>使用与留存</h3><div className="flex gap-3">{[7,30,90].map(n=><button className={styles.link} key={n} aria-pressed={days===n} onClick={()=>setDays(n)}>{n} 天{days===n?" ✓":""}</button>)}</div></div>
    {error?<p role="alert">{error} <button className={styles.link} onClick={()=>setRetry(n=>n+1)}>重试</button></p>:!data?<LoadingStatus>正在读取学习统计…</LoadingStatus>:<>
      <p className={styles.muted}>统计自 {new Date(data.since).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})} 开始。活跃指登录后在前台访问；管理员不计入。历史缺失不会补成零留存。</p>
      <dl className={styles.summary}>{[["活跃账号",data.activeUsers],["实际阅读账号",data.readers],["首次付费账号",data.firstPayments],["付费前阅读中位数",data.medianSecondsBeforePayment===null?"暂无完整样本":`${Math.round(data.medianSecondsBeforePayment/60)} 分钟`]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <h4>注册后留存</h4><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>观察日</th><th>已到观察日的新账号</th><th>当天回访</th><th>留存率</th></tr></thead><tbody>{[1,7,30].map(day=>{const row=data.retention.find(r=>r.day===day);return <tr key={day}><td>第 {day} 天</td><td>{row?.eligible??0}</td><td>{row?.returned??0}</td><td>{row?.eligible?`${Math.round(row.returned/row.eligible*100)}%`:"尚无成熟样本"}</td></tr>;})}</tbody></table></div>
      <h4>首次付费前的有效阅读</h4><p className={styles.muted}>仅统计真实已支付订单，赠送、邀请码和管理员调档不算付费。完整样本 {data.completePayments} 个；另有 {data.firstPayments-data.completePayments} 个账号在统计开始前注册，不能还原其完整付费前时长。</p>
      <p>不足 30 分钟：{data.paymentBuckets.under30} 人　30–120 分钟：{data.paymentBuckets["30to120"]} 人　120 分钟及以上：{data.paymentBuckets.over120} 人</p>
      <details className={styles.details}><summary>每日明细</summary><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>日期</th><th>注册</th><th>活跃账号</th><th>有效阅读分钟</th></tr></thead><tbody>{[...data.daily].reverse().map(row=><tr key={row.day}><td>{row.day}</td><td>{row.registrations}</td><td>{row.active}</td><td>{Math.round(row.seconds/60)}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
