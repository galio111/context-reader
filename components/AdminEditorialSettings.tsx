"use client";
import { useEffect, useState } from "react";
import type { EditorialConfig } from "@/lib/editorialReview";
import styles from "./AdminEditorialSettings.module.css";

export default function AdminEditorialSettings() {
  const [config, setConfig] = useState<EditorialConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => { void fetch("/api/admin/editorial", { cache: "no-store" }).then(async (r) => {
    if (!r.ok) throw new Error(); const data = await r.json(); setConfig(data.config);
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
  return <div className={styles.root}>
    <h3>自动精选</h3>
    <p>审核通过后直接发布，每日目标约 60 篇，成功需 55–68 篇且每板块 13–17 篇。高中及以下暂停更新，原标签和手动候选流程保留。无法确认的文章留在候选区。</p>
    {config ? <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className={styles.check}><input type="checkbox" checked={config.enabled} disabled={busy} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />审核通过后自动发布</label>
      <div className={styles.fields}>
        <label>每日最多尝试篇数<input disabled={busy} type="number" min={30} max={240} required value={config.dailyReviewLimit} onChange={(e) => setConfig({ ...config, dailyReviewLimit: Number(e.target.value) })} /></label>
        <label>每日 AI 成本上限（元）<input disabled={busy} type="number" min={0} max={1.5} step={0.1} required value={config.dailyBudgetCny ?? 1} onChange={(e) => setConfig({ ...config, dailyBudgetCny: Number(e.target.value) })} /></label>
      </div>
      <p>主备模型和 Jev 独立判断在 <a href="/admin?section=models">模型与调用</a> 设置。每日硬上限 ¥1.50，未达到数量或板块门槛会报告缺口。</p>
      <button disabled={busy} type="submit">{busy ? "正在保存…" : "保存精选设置"}</button>
    </form> : <p>正在读取设置…</p>}
    {status && <p role={error ? "alert" : "status"} data-error={error}>{status}</p>}
  </div>;
}
