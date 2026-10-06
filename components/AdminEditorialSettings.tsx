"use client";
import { useEffect, useState } from "react";
import type { EditorialConfig } from "@/lib/editorialReview";
import styles from "./AdminEditorialSettings.module.css";
import type { editorialIntakeStatus } from '@/lib/editorialIntake';

export default function AdminEditorialSettings() {
  const [config, setConfig] = useState<EditorialConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [intake, setIntake] = useState<Awaited<ReturnType<typeof editorialIntakeStatus>> | null>(null);
  useEffect(() => { void fetch("/api/admin/editorial", { cache: "no-store" }).then(async (r) => {
    if (!r.ok) throw new Error(); const data = await r.json(); setConfig(data.config); setIntake(data.intake);
  }).catch(() => { setStatus("自动精选设置暂时无法读取，请刷新重试。"); setError(true); }); }, []);
  async function save() {
    setBusy(true); setStatus(""); setError(false);
    try {
      const response = await fetch("/api/admin/editorial", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "设置保存失败。");
      setConfig(data.config); setStatus("自动精选设置已保存。");
    } catch (e) { setError(true); setStatus(e instanceof TypeError ? "网络暂时不可用，请稍后重试。" : e instanceof Error ? e.message : "设置保存失败。"); }
    finally { setBusy(false); }
  }
  async function retry(sourceId: string, url: string) {
    setBusy(true); setStatus(''); setError(false);
    try {
      const response = await fetch('/api/admin/editorial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry_intake', sourceId, url }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '暂时无法重试。');
      setIntake(data.intake); setStatus('已重新加入待处理队列，下次自动任务会按剩余预算处理。');
    } catch { setError(true); setStatus('重新加入队列未完成，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <div className={styles.root}>
    <h3>自动精选</h3>
    <p>审核通过后直接发布。时事、科学、文化、商业每天各至少 14 篇，每个板块和总数均不设上限。达到门槛后继续精选；高中及以下仍暂停自动更新。</p>
    {config ? <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className={styles.check}><input type="checkbox" checked={config.enabled} disabled={busy} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />审核通过后自动发布</label>
      <div className={styles.fields}>
        <label>每日最多尝试篇数<input disabled={busy} type="number" min={30} max={240} required value={config.dailyReviewLimit} onChange={(e) => setConfig({ ...config, dailyReviewLimit: Number(e.target.value) })} /></label>
        <label>每日 AI 成本上限（元）<input disabled={busy} type="number" min={0} max={1.5} step={0.1} required value={config.dailyBudgetCny ?? 1} onChange={(e) => setConfig({ ...config, dailyBudgetCny: Number(e.target.value) })} /></label>
      </div>
      <p>主备模型和 Jev 独立判断在 <a href="/admin?section=models">模型与调用</a> 设置。每日费用硬上限 ¥1.50、运行时长最多 120 分钟；未处理文章保留到后续任务。未达到板块门槛会报告缺口。</p>
      <button disabled={busy} type="submit">{busy ? "正在保存…" : "保存精选设置"}</button>
    </form> : <p>正在读取设置…</p>}
    {status && <p role={error ? "alert" : "status"} data-error={error}>{status}</p>}
    <section className={styles.intake} aria-label="来源处理记录">
      <h3>来源处理记录</h3>
      <p>每小时分批检查启用来源并保存新链接，每天到设定时间开始审核。订阅更新后仍保留未完成文章。技术故障先重试，重复失败转为需要检查；只有明确的内容判断才记为未入选。这里显示累计记录，已处理记录保留 30 天。</p>
      {intake === null ? <p>正在读取来源记录…</p> : intake.length === 0 ? <p>尚未启用来源。</p> : intake.map(source => <details key={source.id}>
        <summary>{source.name}<span>待审核 {source.counts.waiting} · 待重试 {source.counts.retry} · 需检查 {source.counts.attention}{source.feedErrors.length ? ' · 订阅读取异常' : ''}</span></summary>
        <p>最近发现检查：{source.lastScanAt ? new Date(source.lastScanAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '新记录尚未建立'}（北京时间）<br />内容未入选 {source.counts.rejected} · 重复或规则跳过 {source.counts.skipped} · 已入候选 {source.counts.candidate}</p>
        {source.feedErrors.length > 0 && <p data-error="true">订阅暂时无法完整读取，已保留此前发现的文章；请检查来源连接或页面结构。</p>}
        {source.issues.map(issue => <div className={styles.issue} key={issue.url}>
          <a href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
          <p>{issue.state === 'attention' ? '需要检查' : '等待重试'} · {({ discovery: '来源读取', import: '网页读取', extraction: '正文提取', images: '图片读取', review: '内容审核', storage: '文章保存' })[issue.stage || 'import']}<br />{issue.reason}</p>
          <button type="button" disabled={busy} onClick={() => void retry(source.id, issue.url)}>重新加入队列</button>
        </div>)}
        {source.counts.retry + source.counts.attention > source.issues.length && <p>显示最近 {source.issues.length} 条技术问题，其余记录仍保留。</p>}
        {source.decisions?.length > 0 && <details><summary>最近的内容未入选原因</summary>{source.decisions.map(issue => <div className={styles.issue} key={issue.url}><a href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a><p>{issue.reason}</p></div>)}</details>}
      </details>)}
    </section>
  </div>;
}
