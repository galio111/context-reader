"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { LoadingStatus } from "./LoadingStatus";
import { readCetActivities } from "@/lib/cetActivityStorage";
import { cetLearningSummary } from "@/lib/cetLearningSummary";
import { ACCOUNT_DATA_CHANGED_EVENT, ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { openStudy } from "@/lib/studyNavigation";
import styles from "./AccountLearningSummary.module.css";
type Summary = { seconds: number; todaySeconds: number; readingDays: number; since: string };
const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds/60)} 分钟` : `${(seconds/3600).toFixed(1)} 小时`;
export function AccountLearningSummary() {
  const { account } = useAccount();
  const owner = account.profile?.userId;
  const [summary, setSummary] = useState<Summary | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0), [cet, setCet] = useState(() => cetLearningSummary([]));
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController(); setSummary(null); setError("");
    void fetch("/api/account/activity", { headers: { "X-Context-Account": owner }, signal: controller.signal, cache: "no-store" })
      .then(async r => { if (!r.ok) throw Error(); setSummary(await r.json()); })
      .catch(() => { if (!controller.signal.aborted) setError("阅读记录暂时无法读取。"); });
    const refresh = () => setCet(cetLearningSummary(readCetActivities().filter(a => a.owner === owner)));
    refresh(); window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, refresh); window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh);
    return () => { controller.abort(); window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, refresh); window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh); };
  }, [owner, retry]);
  return <section className={styles.section} aria-label="我的学习记录">
    <header><h2>我的学习记录</h2><button onClick={() => openStudy("profile")}>阅读画像 <span aria-hidden="true">↗</span></button></header>
    {error ? <p role="alert">{error} <button onClick={() => setRetry(n=>n+1)}>重试</button></p> : !summary ? <LoadingStatus>正在读取学习记录…</LoadingStatus> : <dl className={styles.metrics}>
      <div><dt>今天有效阅读</dt><dd>{duration(summary.todaySeconds)}</dd></div>
      <div><dt>累计有效阅读</dt><dd>{duration(summary.seconds)}</dd></div>
      <div><dt>有阅读的天数</dt><dd>{summary.readingDays}<small> 天</small></dd></div>
      <div><dt>真题正确率</dt><dd>{cet.scoreable ? `${Math.round(cet.correct/cet.scoreable*100)}%` : "—"}</dd><small>{cet.scoreable ? `${cet.correct} / ${cet.scoreable} 题` : "提交真题后显示"}</small></div>
    </dl>}
    {cet.excluded>0 && <p className={styles.note}>{cet.excluded} 组存在不同提交结果，未合并计入正确率。</p>}
  </section>;
}
