"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import identity from "@/chrome-extension/identity.json";
import styles from "./BrowserExtensionSettings.module.css";

type Connection = { id: string; label: string; expires_at: string; created_at: string };
type ChromeBridge = { runtime?: { sendMessage: (id: string, data: unknown, callback: (result: Record<string, unknown> | undefined) => void) => void; lastError?: { message?: string } } };
function bridge(data: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const runtime = (window as Window & { chrome?: ChromeBridge }).chrome?.runtime;
    if (!runtime?.sendMessage) return reject(new Error("请先安装扩展，再刷新此页面。"));
    const timer = setTimeout(() => reject(new Error("连接超时，请确认扩展已启用并重试。")), 20000);
    runtime.sendMessage(identity.id, data, result => { clearTimeout(timer); if (runtime.lastError || !result) reject(new Error("尚未检测到扩展，请安装并刷新此页。")); else if (result.error) reject(new Error(String(result.error))); else resolve(result); });
  });
}
export function BrowserExtensionSettings() {
  const { account, savedAccounts, openLogin, loading } = useAccount();
  const [installed, setInstalled] = useState(false), [connectedName, setConnectedName] = useState("");
  const [connectedId, setConnectedId] = useState("");
  const [targetId, setTargetId] = useState(""), [label, setLabel] = useState("我的 Chrome");
  const [connections, setConnections] = useState<Connection[]>([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const revision = useRef(0);
  const accounts = savedAccounts.length ? savedAccounts : account.profile ? [{ userId: account.profile.userId, nickname: account.profile.nickname, phone: account.profile.phone }] : [];
  useEffect(() => { bridge({ type: "ping" }).then(r => { setInstalled(true); setConnectedName(String(r.nickname || "")); setConnectedId(String(r.connectionId || "")); }).catch(() => setInstalled(false)); }, []);
  useEffect(() => { if (!targetId && account.profile) setTargetId(account.profile.userId); }, [account.profile, targetId]);
  async function refresh(id: string) {
    const ticket = ++revision.current; setError("");
    try { const r = await fetch(`/api/extension/connections?accountId=${encodeURIComponent(id)}`, { cache: "no-store" }); const data = await r.json(); if (ticket !== revision.current) return; if (!r.ok) throw new Error(data.error || "连接列表加载失败，请重试。"); setConnections(data.connections); }
    catch (e) { if (ticket === revision.current) setError(e instanceof Error ? e.message : "连接列表加载失败。"); }
  }
  useEffect(() => { setConnections([]); setNotice(""); if (targetId) refresh(targetId); return () => { revision.current++; }; }, [targetId]);
  async function connect() {
    if (!targetId) { openLogin("登录后设置扩展的保存账号。"); return; }
    if (!installed) { setError("请先安装扩展，再刷新此页。"); return; }
    const selected = targetId; setBusy(true); setError(""); setNotice("");
    let created = "", delivered = false;
    try {
      const response = await fetch("/api/extension/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, accountId: selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "连接失败，请重试。"); created = data.connection.id;
      const result = await bridge({ type: "connect", token: data.token }); if (!result.connected) throw new Error("扩展未完成连接，请重试。"); delivered = true;
      const name = accounts.find(a => a.userId === selected)?.nickname || data.account.nickname;
      setConnectedName(name); setConnectedId(String(result.connectionId || created)); setNotice(`已连接：此扩展的新查询与生词将保存到「${name}」。`); await refresh(selected);
    } catch (e) {
      if (created && !delivered) await fetch("/api/extension/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: created, accountId: selected }) }).catch(() => undefined);
      setError(e instanceof Error ? e.message : "连接失败，请重试。");
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try { const r = await fetch("/api/extension/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, accountId: targetId }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); if (id === connectedId) { setConnectedName(""); setConnectedId(""); } await bridge({ type: "disconnect", connectionId: id }).catch(() => undefined); setNotice("已解除连接，此连接不能继续查询或保存。"); await refresh(targetId); }
    catch (e) { setError(e instanceof Error ? e.message : "解除连接失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><Link className={styles.back} href="/">← 返回首页</Link><header className={styles.header}><h1>把语境解释带到其他网页</h1><p>Chrome 划词助手</p><div className={styles.intro}>划选一个英文词或短语，按下快捷键，在原网页旁读懂它。支持 Windows 和 Mac 的桌面 Chrome。</div><a className={styles.primary} href="/downloads/context-reader-chrome.zip" download>下载 Chrome 扩展 ZIP ↓</a><span className={styles.version}>1.0.0 · {installed ? "已检测到扩展" : "安装后刷新此页连接账号"}</span></header>
    <section className={styles.section}><h2>第一次安装</h2><ol><li>下载并解压整个扩展文件夹。</li><li>在 Chrome 地址栏打开 <code>chrome://extensions</code>，开启右上角“开发者模式”。</li><li>点击“加载已解压的扩展程序”，选择含 <code>manifest.json</code> 的文件夹。</li><li>刷新此页，在下方选择保存账号并连接。安装前已打开的网页也请刷新。</li></ol><p className={styles.note}>Chrome 要求确认安装，下载 ZIP 后不会自动安装。Chrome 系统页面、应用商店和内置 PDF 阅读器暂不支持。</p></section>
    <section className={styles.section}><h2>生词保存到哪个账号</h2><p>在这里指定此浏览器扩展的保存目标。之后切换网站账号，也不会悄悄更改扩展的保存账号。</p>{connectedName && <p className={styles.connected}>此扩展当前连接：<strong>{connectedName}</strong></p>}
      {accounts.length ? <div className={styles.form}><label>保存账号<select value={targetId} disabled={busy} onChange={e => setTargetId(e.target.value)}>{accounts.map(a => <option key={a.userId} value={a.userId}>{a.nickname || "账号"}{a.phone ? ` · ${a.phone.slice(-4)}` : ""}</option>)}</select></label><label>浏览器名称<input value={label} disabled={busy} maxLength={60} onChange={e => setLabel(e.target.value)} placeholder="例如：Mac 上的 Chrome" /></label><button className={styles.primary} disabled={busy || !targetId} onClick={connect}>{busy ? "正在处理…" : "连接所选账号"}</button><Link href="/account/usage">管理网站登录账号 ↗</Link></div> : <button className={styles.primary} disabled={loading} onClick={() => openLogin("登录后设置扩展的保存账号。")}>登录并连接保存账号</button>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      {connections.length > 0 && <div className={styles.connections}><h3>所选账号的扩展连接</h3>{connections.map(c => <div key={c.id}><span><strong>{c.label}</strong><small>{new Date(c.expires_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 到期</small></span><button disabled={busy} onClick={() => revoke(c.id)}>解除连接</button></div>)}</div>}
    </section><section className={styles.section}><h2>按你的习惯调整</h2><p>点击 Chrome 工具栏里的扩展图标，即可设置浮窗宽高、背景透明度、背景色、文字色和强调色。浮窗也可以拖动和缩放。</p><p>快捷键通过扩展设置中的“设置 Chrome 快捷键”修改。默认按快捷键查询，也可开启划词后自动显示。</p><p className={styles.note}>能取得完整原句时，显示与网站相同的语境解释；只能取得单词时显示词典释义。仅在触发查询时发送所选词与相邻句子，不上传整个网页。连接凭证仅允许扩展查询和保存生词，90 天后需要重新连接。</p></section></main>;
}
