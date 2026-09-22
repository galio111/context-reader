"use client";
import { Fragment, useEffect, useState } from "react";
import type { AdminUsageReport as Report, UsageGroup, UsageTotals } from "@/lib/adminUsageReport";
import styles from "./AdminUsageReport.module.css";

const sourceNames: Record<string, string> = { all: "全部来源", reader: "用户使用", system: "后台任务", unclassified: "待归属" };
const number = (n: number) => n.toLocaleString("zh-CN");
const money = (n: number) => `¥${(n / 1_000_000).toFixed(6)}`;
const cost = (t: UsageTotals) => `${money(t.costMicrocny)}${t.unknownCost ? " + 待核算" : ""}`;

function Breakdown({ rows }: { rows: UsageGroup[] }) {
  return <table className={styles.table}><thead><tr><th>模型 / 功能</th><th>调用</th><th>失败 / 取消</th><th>输入 / 输出 Token</th><th>缓存输入 Token</th><th>估算成本</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{number(row.calls)}</td><td>{row.failed} / {row.cancelled}</td><td>{number(row.input)} / {number(row.output)}</td><td>{number(row.cacheTokens)}</td><td>{cost(row)}{row.unknownCost > 0 && <small>{row.unknownCost} 次待核算</small>}</td></tr>)}</tbody></table>;
}

export default function AdminUsageReport({ profiles, onSelectUser }: { profiles: Array<Record<string, unknown>>; onSelectUser: (userId: string) => void }) {
  const [period, setPeriod] = useState("today"), [date, setDate] = useState(""), [scope, setScope] = useState("all");
  const [view, setView] = useState("features"), [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [data, setData] = useState<Report | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ period, scope });
    if (period === "date") params.set("date", date);
    void fetch(`/api/admin/usage?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "用量报表暂时无法读取。");
      if (!controller.signal.aborted) setData(result);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof TypeError ? "网络连接失败，请检查连接后重试。" : err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, date, scope, refresh]);
  const name = (id: string) => { const p = profiles.find(p => p.user_id === id); return p ? String(p.nickname || p.phone || p.email || id) : `${id.slice(0, 8)}…`; };
  return <div className={styles.report} aria-busy={loading}>
    <div className={styles.header}><div><h3>用量与成本</h3><p className={styles.muted}>先看功能消耗，再展开各模型。所有日期按上海时间。</p></div><button type="button" className={styles.button} disabled={loading} onClick={() => setRefresh(n => n + 1)}>刷新报表</button></div>
    <div className={styles.toolbar}>
      <label>统计时间<select value={period} onChange={e => { if (e.target.value === "date" && !date) setDate(data?.window.today || new Date(Date.now() + 28800000).toISOString().slice(0, 10)); setPeriod(e.target.value); }}><option value="today">今天</option><option value="yesterday">昨天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="date">指定单日</option></select></label>
      {period === "date" && <label>上海日期<input type="date" value={date} min={data?.window.oldest} max={data?.window.today} onChange={e => setDate(e.target.value)} /></label>}
      <label>费用来源<select value={scope} onChange={e => setScope(e.target.value)}>{Object.entries(sourceNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
    </div>
    {error && <p role="alert" className={styles.warning}>{error} <button type="button" className={styles.link} onClick={() => setRefresh(n => n + 1)}>重新读取</button></p>}
    {loading ? <div role="status" className={styles.loading}>正在读取所选时间的账本…</div> : !error && data && <>
      <div className={styles.title}><strong>{data.window.days.at(-1)}{data.window.days.length > 1 ? ` 至 ${data.window.days[0]}` : ""} · {sourceNames[data.window.scope]}</strong><span>更新于 {new Date(data.loadedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}</span></div>
      {data.truncated && <p className={styles.warning} role="status">记录达到安全读取上限（每类 50,000 条），以下为已载入部分，不能视为完整总额。请缩短日期范围。</p>}
      {data.total.unknownCost > 0 && <p className={styles.warning}>有 {number(data.total.unknownCost)} 次调用缺少可核算 Token 或模型费率。已知成本未包含这些记录，失败也不代表零费用。</p>}
      <dl className={styles.summary}>{[["已知估算成本", money(data.total.costMicrocny)], ["模型调用", number(data.total.calls)], ["失败 / 取消", `${data.total.failed} / ${data.total.cancelled}`], ["有扣量的操作", number(data.total.chargedActions)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className={styles.source}>{data.sources.map(row => <span key={row.key}>{sourceNames[row.key]}：{cost(row)}</span>)}</div>
      <section className={styles.section} aria-label="用量拆分">
        <div className={styles.tabs}>{[["features", "按功能"], ["models", "按模型"]].map(([key, label]) => <button type="button" key={key} className={styles.button} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
        <p className={styles.muted}>用户操作与模型调用分别计数；一次操作可能触发多个模型或多个翻译批次。缓存命中可没有模型调用。</p>
        {(view === "features" ? data.features : data.models).length === 0 ? <p className={styles.empty}>所选时间和来源没有已记录用量。</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{view === "features" ? "功能 / 来源" : "供应商 / 模型"}</th><th>估算成本</th><th>模型调用</th><th>失败 / 取消</th>{view === "features" && <th>操作 / 扣量操作</th>}<th>详情</th></tr></thead><tbody>{(view === "features" ? data.features : data.models).map(row => <Fragment key={row.key}><tr><td><strong>{row.label}</strong>{view === "features" && <small>{sourceNames[row.scope]}</small>}</td><td>{cost(row)}</td><td>{number(row.calls)}</td><td className={row.failed ? styles.failure : undefined}>{row.failed} / {row.cancelled}</td>{view === "features" && <td>{row.actions} / {row.chargedActions}<small>缓存 {row.cacheHits} · 扣 {row.quotaUnits} 单位</small></td>}<td><button type="button" className={styles.link} aria-expanded={expanded.includes(`${view}:${row.key}`)} onClick={() => setExpanded(items => items.includes(`${view}:${row.key}`) ? items.filter(key => key !== `${view}:${row.key}`) : [...items, `${view}:${row.key}`])}>{expanded.includes(`${view}:${row.key}`) ? "收起" : "展开"}</button></td></tr>{expanded.includes(`${view}:${row.key}`) && <tr><td colSpan={view === "features" ? 6 : 5}><div className={styles.nested}><Breakdown rows={view === "features" ? row.children : data.features.flatMap(f => f.children.filter(c => c.key === row.key).map(c => ({ ...c, key: f.key, label: `${f.label} · ${sourceNames[f.scope]}` })))} />{row.calls === 0 && <p>没有模型调用；以上为操作与扣量记录。</p>}</div></td></tr>}</Fragment>)}</tbody></table></div>}
      </section>
      <section className={styles.section}><h4>账号消耗排行</h4><p className={styles.muted}>按所选范围的已知成本排序，最多展示前 20 个账号。仅包含能归属到账号的用量；游客与后台任务不算个人消耗。</p>{data.accounts.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>用户</th><th>模型调用</th><th>失败</th><th>估算成本</th><th>扣量操作</th></tr></thead><tbody>{data.accounts.slice(0, 20).map(row => <tr key={row.key}><td><button className={styles.link} onClick={() => onSelectUser(row.key)}>{name(row.key)}</button></td><td>{row.calls}</td><td className={row.failed ? styles.failure : undefined}>{row.failed}</td><td>{cost(row)}</td><td>{row.chargedActions}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>所选范围没有可归属账号的记录。</p>}</section>
      <details className={styles.details}><summary>每日趋势与 Token 明细</summary><Breakdown rows={data.daily} /></details>
      <details className={styles.details}><summary>最近调用记录（{data.details.length} 条）</summary>{data.detailsTruncated && <p className={styles.muted}>这里只展示最近 200 条，汇总使用全部已载入记录。</p>}<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>时间 / 功能</th><th>来源 / 账号</th><th>实际模型</th><th>结果</th><th>输入 / 输出</th><th>估算成本</th></tr></thead><tbody>{data.details.map(row => <tr key={row.id}><td>{new Date(row.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}<small>{row.feature}</small></td><td>{sourceNames[row.scope]}{row.userId && <small>{name(row.userId)}</small>}</td><td>{row.model}</td><td>{({ succeeded: "成功", failed: "失败", cancelled: "取消" } as Record<string, string>)[row.status] || "未完成"}</td><td>{row.input} / {row.output}</td><td>{row.costMicrocny === null ? "待核算" : money(row.costMicrocny)}</td></tr>)}</tbody></table></div></details>
      <details className={styles.details}><summary>统计口径与费率说明</summary><p className={styles.muted}>统计来自站内执行与操作账本，不是供应商账单。沿用站内已配置费率：DeepSeek 按调用时间与缓存拆分，GLM-4.5-Air、MiMo V2.6 Flash 和 Jev 分别估算；未知型号不套用其他模型价格。已入账的主备尝试分别计数；旧路径未入账的中间失败无法还原。失败且无 Token 的记录待核算。金额展示到人民币小数点后六位。</p><p className={styles.muted}>操作与扣量按操作创建时间归属，费用按实际调用时间归属，跨日任务可能分属不同日期。后台系统动作不是用户操作，汇总不用于重新扣量。非 AI 导入仅展示已有账本记录的游客操作，不能据此推算全站导入总次数。历史账本漏记、账号删除或供应商尚未返回的消耗无法恢复。</p></details>
    </>}
  </div>;
}
