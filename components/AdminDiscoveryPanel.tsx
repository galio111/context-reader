"use client";
import { useEffect, useState } from "react";
import type { DiscoverySite, DiscoveryDay } from "@/lib/discoveryStore";
import type { RecommendationAutomationStatus } from "@/types/recommendationCrawler";
import { ARTICLE_TOPICS } from "@/types/publicArticle";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#c4ccd4] px-3 text-sm font-medium text-[#234861] hover:bg-[#edf5fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa] disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-[#b7c0c9] bg-white px-3 py-2.5 text-sm text-[#17212a] focus:outline-2 focus:outline-[#1769aa]";
export default function AdminDiscoveryPanel({ onRefresh, onCandidates }: { onRefresh: () => Promise<void>; onCandidates: () => void }) {
  const [sites, setSites] = useState<DiscoverySite[]>([]);
  const [day, setDay] = useState<DiscoveryDay | null>(null);
  const [automation, setAutomation] = useState<RecommendationAutomationStatus | null>(null);
  const [edit, setEdit] = useState<DiscoverySite | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [feedback, setFeedback] = useState<Record<string, Array<{ title: string; reason: string }>>>({});
  async function load() {
    const [sourceResponse, configResponse] = await Promise.all([fetch("/api/admin/discovery-sources", { cache: "no-store" }), fetch("/api/admin/article-crawler", { cache: "no-store" })]);
    const sources = await sourceResponse.json(); const config = await configResponse.json();
    if (!sourceResponse.ok || !configResponse.ok) throw new Error(sources.error || config.error || "后台设置读取失败。");
    setSites(sources.sites); setDay(sources.day); setAutomation(config.automation); setLoaded(true);
    setFeedback(sources.feedback || {});
  }
  useEffect(() => { void load().catch((e) => setError(e.message)); }, []);
  async function perform(action: string, id?: string, site?: DiscoverySite) {
    setBusy(action + (id || "")); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/discovery-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, site }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作暂时失败。");
      setMessage(action === "verify" ? data.verification.message : action === "run"
        ? data.result ? `本批新增 ${data.result.created.length} 篇。今天的每站额度仍然有效，自动任务会继续处理其余网站。` : "当前没有可执行网站：可能已到每日目标、处于 30 分钟重试间隔，或今日检查次数已用完。"
        : action === "delete" ? "网站已从名单移除，已收录文章和今日记录保留。" : "网站设置已保存。");
      if (action === "save") setEdit(null);
      await load(); if (action === "run") await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "操作暂时失败，请稍后刷新。"); }
    finally { setBusy(""); }
  }
  async function saveSchedule() {
    if (!automation) return;
    setBusy("schedule"); setError("");
    try {
      const response = await fetch("/api/admin/article-crawler", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(automation.config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败。");
      setAutomation(data.automation); setMessage("自动抓取时间已保存，数量由各网站的每日目标决定。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); } finally { setBusy(""); }
  }
  async function testEmail() {
    setBusy("email"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/article-crawler", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test_email" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "测试邮件暂时发送失败。");
      setMessage("测试邮件已发送，请检查通知邮箱。");
    } catch (e) { setError(e instanceof Error ? e.message : "测试邮件暂时发送失败。"); } finally { setBusy(""); }
  }
  const enabled = sites.filter((s) => s.enabled);
  return <section className="rounded-xl bg-white p-5 sm:p-6" aria-labelledby="discovery-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="discovery-title" className="text-xl font-semibold text-[#17191c]">候选来源与每日抓取</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#485661]">每站独立计数，按最新发布时间寻找未收录文章。只加入候选，不自动发布。</p></div>
      <button className={button} onClick={onCandidates}>查看候选</button>
    </div>
    {(message || error) && <p role={error ? "alert" : "status"} className={`mt-4 rounded-lg px-3 py-3 text-sm leading-6 ${error ? "bg-red-50 text-red-800" : "bg-[#edf5fb] text-[#234861]"}`}>{error || message}</p>}
    {!loaded && <p className="mt-4 text-sm text-[#485661]">正在读取网站与今日记录…</p>}
    {loaded && <>
      <p className="my-4 text-sm text-[#34424d]">日常启用 {enabled.length} 站，其中低难度专门来源 {enabled.filter((s) => s.levelHint === "lower").length} 站；每日合计目标 {enabled.reduce((n, s) => n + s.dailyTarget, 0)} 篇。备选或停用 {sites.length - enabled.length} 站。</p>
      <details className="border-y border-[#dce2e7] py-3 text-sm text-[#34424d]"><summary className="cursor-pointer font-medium">查看当前硬规则与反馈如何生效</summary><p className="mt-3 max-w-3xl leading-7">时事和商业必须有可靠日期且不超过 7 天；长期有效的知识、文化和故事可以较旧。拒绝广告软文、付费墙、短讯、低信息量、立场宣传和过于专业的科技文章。普通原文至少 250 词，学习类至少 180 词，并且要有完整阅读价值，配图必须能安全保存。网站须近期持续更新。数量不足时报告原因，不放宽这些规则。</p><p className="mt-2 max-w-3xl leading-7">不精选原因会保存。“内容没兴趣”会减少高度相似文章；“太专业或太难”会对该网站相似主题收紧筛选。广告、正文和图片问题会在网站记录中提示复查，不会悄悄禁用整个网站。自动判断不替代发布前的人工审核。</p></details>
      {automation && <div className="my-4 flex flex-wrap items-end gap-4">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={automation.config.enabled} disabled={!!busy} onChange={(e) => setAutomation({ ...automation, config: { ...automation.config, enabled: e.target.checked } })} />每天自动抓取</label>
        <label className="text-sm">开始时间（北京时间）<input className={input} type="time" step={300} value={automation.config.runTime} disabled={!!busy} onChange={(e) => setAutomation({ ...automation, config: { ...automation.config, runTime: e.target.value } })} /></label>
        <button className={button} disabled={!!busy} onClick={() => void saveSchedule()}>保存时间</button>
        <button className={button} disabled={!!busy || !enabled.length} onClick={() => void perform("run")}>{busy.startsWith("run") ? "正在处理一个网站…" : "立即处理下一站"}</button>
        <button className={button} disabled={!!busy} onClick={() => void load().catch((e) => setError(e.message))}>刷新状态</button>
      </div>}
      <p className="mb-4 max-w-3xl text-xs leading-6 text-[#485661]">服务器每 5 分钟检查并处理一个网站，逐批完成整份名单，关闭电脑不影响执行。每站每日检查次数有限，随目标篇数调整；目标 2 篇时最多检查 3 批，每批最多尝试 3 篇，重试至少间隔 30 分钟；手动运行也遵守每日目标。每站 2 篇是入选目标，不保证源网站每天发布 2 篇合格新作。</p>
      {automation && <details className="mb-4 text-sm text-[#485661]"><summary className="cursor-pointer">运行结果与邮件通知</summary><p className="my-2 leading-6">通知邮箱：{automation.emailConfigured ? automation.notificationEmail : "尚未配置"}。上次新增 {automation.state.lastCreatedCount} 篇；{automation.state.lastError || "暂无异常记录"}。邮件状态：{automation.state.lastEmailStatus === "sent" ? "已发送" : automation.state.lastEmailStatus === "failed" ? "发送失败" : "尚未发送"}。</p><button className={button} disabled={!!busy || !automation.emailConfigured} onClick={() => void testEmail()}>发送测试邮件</button></details>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce2e7] pb-3"><h3 className="font-semibold">网站名单</h3><button className={button} disabled={!!busy} onClick={() => setEdit({ id: "", name: "", feedUrl: "", feeds: [""], articleHosts: [""], topics: ["社会生活"], levelHint: "mixed", discovery: "feed", enabled: false, dailyTarget: 2, note: "" })}>添加网站</button></div>
      {edit && <form className="my-4 space-y-4 rounded-lg bg-[#f1f5f8] p-4" onSubmit={(e) => { e.preventDefault(); void perform("save", edit.id, edit); }}>
        <h4 className="font-semibold">编辑网站</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">网站名称<input required maxLength={120} className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="text-sm">正文域名（例如 example.com）<input required className={input} disabled={sites.some((s) => s.id === edit.id)} value={edit.articleHosts[0]} onChange={(e) => setEdit({ ...edit, articleHosts: [e.target.value.trim().toLowerCase()], id: e.target.value.trim().toLowerCase().replaceAll(".", "-") })} /></label>
          <label className="text-sm">每日目标篇数<input required className={input} type="number" min={0} max={10} value={edit.dailyTarget} onChange={(e) => setEdit({ ...edit, dailyTarget: Number(e.target.value) })} /></label>
          <label className="text-sm">来源用途<select className={input} value={edit.levelHint} onChange={(e) => setEdit({ ...edit, levelHint: e.target.value as DiscoverySite["levelHint"] })}><option value="mixed">普通原文，按实际难度分类</option><option value="lower">专门补充较低难度</option><option value="advanced">进阶原文</option></select></label>
        </div>
        <label className="block text-sm">{edit.discovery === "index" ? "已适配的文章列表地址" : "RSS / Atom 订阅地址，每行一个，最多 6 个"}<textarea required className={input} rows={3} value={edit.feeds.join("\n")} onChange={(e) => setEdit({ ...edit, feeds: e.target.value.split("\n") })} /></label>
        <fieldset><legend className="mb-2 text-sm">主要主题，可多选</legend><div className="flex flex-wrap gap-3">{ARTICLE_TOPICS.map((topic) => <label key={topic} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={edit.topics.includes(topic)} onChange={(e) => setEdit({ ...edit, topics: e.target.checked ? [...edit.topics, topic] : edit.topics.filter((t) => t !== topic) })} />{topic}</label>)}</div></fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={edit.enabled} disabled={!edit.verification?.ok} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />启用日常抓取（先保存并验证）</label>
        <div className="flex gap-3"><button className={button} disabled={!!busy}>保存网站</button><button className={button} type="button" onClick={() => setEdit(null)}>取消编辑</button></div>
      </form>}
      <label className="my-4 block max-w-xs text-sm">显示网站<select className={input} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部网站</option><option value="enabled">日常启用</option><option value="lower">低难度专门来源</option><option value="paused">备选 / 停用</option></select></label>
      <ul className="divide-y divide-[#dce2e7]">{sites.filter((s) => filter === "all" || (filter === "enabled" ? s.enabled : filter === "lower" ? s.levelHint === "lower" : !s.enabled)).map((site) => {
        const record = day?.sites[site.id];
        return <li key={site.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h4 className="break-words font-semibold text-[#17212a]">{site.name} <span className="ml-2 text-xs font-normal text-[#485661]">{site.enabled ? "日常启用" : "备选 / 停用"}{site.levelHint === "lower" ? " · 低难度专门来源" : ""}</span></h4><p className="mt-1 text-sm text-[#485661]">{site.topics.join("、")} · 今日 {record?.created || 0} / {site.dailyTarget} 篇 · 已检查 {record?.visits || 0} 批</p></div>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={!!busy} onClick={() => setEdit(site)}>编辑</button><button className={button} disabled={!!busy} onClick={() => void perform("verify", site.id)}>{busy === "verify" + site.id ? "正在验证…" : "验证网站"}</button><button className={button} disabled={!!busy || !site.enabled} onClick={() => void perform("run", site.id)}>抓取本站</button><button className={button} disabled={!!busy} onClick={() => { if (window.confirm(`从抓取名单移除 ${site.name}？已收录文章保留。`)) void perform("delete", site.id); }}>移除</button></div>
          </div>
          <p className="mt-2 text-xs leading-6 text-[#485661]">{site.verification?.message || site.note}</p>
          <details className="mt-2 text-sm text-[#34424d]"><summary className="cursor-pointer text-[#175a8d]">查看地址、验证样本与跳过原因</summary>
            <ul className="my-2 space-y-2 break-all text-xs">{site.feeds.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="underline">{url}</a></li>)}</ul>
            {site.verification && <p className="text-xs">上次验证：{new Date(site.verification.at).toLocaleString("zh-CN")}</p>}
            {!!feedback[site.id]?.length && <div className="mt-3"><p className="text-xs font-semibold">近期不精选反馈，请复查该站清洗与内容：</p><ul className="mt-2 space-y-2 text-xs leading-6">{feedback[site.id].map((item, i) => <li key={i}>{item.title}：{item.reason}</li>)}</ul></div>}
            {site.verification?.samples.map((sample) => <div key={sample.url} className="my-3"><a href={sample.url} target="_blank" rel="noreferrer" className="font-medium text-[#175a8d] underline">{sample.title}</a><p className="mt-1 text-xs">{sample.words} 词 · {sample.images} 张图片</p><p className="mt-2 max-w-3xl text-sm leading-7" lang="en">{sample.preview}…</p></div>)}
            {record?.issues.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-6">{record.issues.map((issue, i) => <li key={i}>{issue.title}：{issue.reason}</li>)}</ul> : <p className="mt-2 text-xs">今日尚无跳过记录。</p>}
          </details>
        </li>;
      })}</ul>
    </>}
  </section>;
}
