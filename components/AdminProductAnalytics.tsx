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
  const [days, setDays] = useState(30), [retry, setRetry] = useState(0);
  const [data, setData] = useState<Report | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setLoading(true);
    void fetch(`/api/admin/product-analytics?days=${days}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw Error();
        const report = await response.json();
        if (!controller.signal.aborted) setData(report);
      })
      .catch(() => { if (!controller.signal.aborted) setError("留存分析暂时无法读取。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, retry]);
  return <section className={styles.report} aria-label="留存分析" aria-busy={loading}>
    <header className={styles.header}><h3>留存分析</h3><button type="button" className={styles.button} disabled={loading} onClick={() => setRetry(n => n + 1)}>刷新分析</button></header>
    <div className={styles.toolbar}>
      <label>观察范围<select value={days} onChange={event => { setData(null); setDays(Number(event.target.value)); }}>{[7, 30, 90].map(value => <option key={value} value={value}>近 {value} 天</option>)}</select></label>
      {loading && <LoadingStatus>正在更新…</LoadingStatus>}
    </div>
    {error && <p role="alert" className={styles.warning}>{error} <button type="button" className={styles.link} onClick={() => setRetry(n => n + 1)}>重试</button></p>}
    {data && <>
      <section className={styles.section} aria-labelledby="retention-cohorts">
        <h4 id="retention-cohorts">新用户回来了吗</h4>
        <p className={styles.muted}>范围内注册的账号，在注册后第 1、7、30 天再次访问的比例。</p>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">观察日</th><th scope="col">已到观察日</th><th scope="col">当天回访</th><th scope="col">留存率</th></tr></thead><tbody>{[1, 7, 30].map(day => {
          const row = data.retention.find(item => item.day === day);
          return <tr key={day}><th scope="row">{day === 1 ? "次日" : `第 ${day} 天`}</th><td>{row?.eligible ?? 0} 人</td><td>{row?.returned ?? 0} 人</td><td>{row?.eligible ? `${Math.round(row.returned / row.eligible * 100)}%` : "待观察"}</td></tr>;
        })}</tbody></table></div>
      </section>
      <section className={styles.section} aria-labelledby="retention-reading">
        <h4 id="retention-reading">访问与阅读</h4>
        <dl className={styles.summary}><div><dt>范围内访问账号</dt><dd>{data.activeUsers}</dd></div><div><dt>有有效阅读的账号</dt><dd>{data.readers}</dd></div><div><dt>有效阅读总时长</dt><dd>{Math.round(data.daily.reduce((sum, row) => sum + row.seconds, 0) / 60)} 分钟</dd></div></dl>
        <details className={styles.details}><summary>每日注册与阅读</summary><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>日期</th><th>新注册</th><th>访问账号</th><th>有效阅读分钟</th></tr></thead><tbody>{[...data.daily].reverse().map(row => <tr key={row.day}><td>{row.day}</td><td>{row.registrations}</td><td>{row.active}</td><td>{Math.round(row.seconds / 60)}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className={styles.section} aria-labelledby="retention-payment">
        <h4 id="retention-payment">首次付费前读了多久</h4>
        <dl className={styles.summary}><div><dt>范围内首次付费</dt><dd>{data.firstPayments} 人</dd></div><div><dt>阅读记录完整</dt><dd>{data.completePayments} 人</dd></div><div><dt>付费前阅读中位数</dt><dd>{data.medianSecondsBeforePayment === null ? "暂无完整样本" : `${Math.round(data.medianSecondsBeforePayment / 60)} 分钟`}</dd></div></dl>
        {data.completePayments > 0 && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>付费前有效阅读</th><th>账号数</th></tr></thead><tbody>{[["不足 30 分钟", data.paymentBuckets.under30], ["30–120 分钟", data.paymentBuckets["30to120"]], ["120 分钟及以上", data.paymentBuckets.over120]].map(([label, count]) => <tr key={label}><td>{label}</td><td>{count} 人</td></tr>)}</tbody></table></div>}
        {data.firstPayments > data.completePayments && <p className={styles.muted}>{data.firstPayments - data.completePayments} 个账号缺少完整历史，未计入阅读时长分析。</p>}
      </section>
      <details className={styles.details}><summary>统计口径与采集时间</summary><p className={styles.muted}>采集开始于 {new Date(data.since).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。按上海日期统计，排除当前管理员与游客。访问表示登录后在前台打开网站；有效阅读仅记录文章内活跃阅读，真题和背词单独记录。</p><p className={styles.muted}>留存只包含采集开始后注册且已到观察日的账号，历史缺失不记作零留存。付费以真实支付时间为准，赠送、邀请码和管理员调档不算付费；付费前阅读仅包含历史完整的账号。</p></details>
    </>}
  </section>;
}
