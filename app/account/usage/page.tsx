"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import type { UsageMetricKey } from "@/types/account";

const metricLabels: Record<UsageMetricKey, string> = {
  guest_lookup: "游客查词",
  lookup_generation: "查词与问答",
  deep_reading: "深度阅读点数",
};

const plans = [
  ["免费", "¥0", "每天 30 次查词 · 每月 20 点深度阅读"],
  ["基础", "¥5 / 月", "每天 80 次查词 · 每月 150 点深度阅读"],
  ["Plus", "¥10 / 月", "每天 200 次查词 · 每月 500 点深度阅读"],
  ["Max", "¥30 / 月", "每天 600 次查词 · 每月 2,000 点深度阅读"],
] as const;

export default function UsagePage() {
  const { account, loading, openLogin, refreshAccount, syncNow, logout } = useAccount();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const accountIdentifier = account.profile?.phone
    ? `手机号 ${account.profile.phone}`
    : account.profile?.email || "";
  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  async function exportData() {
    await syncNow();
    const response = await fetch("/api/account/export", { cache: "no-store" });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `context-reader-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出登录失败，请稍后重试。");
      setLoggingOut(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f5f2] px-4 py-8 text-[#18211d] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-lg font-semibold" href="/">Context Reader</Link>
          <Link className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm" href="/">返回阅读</Link>
        </header>

        <section className="mt-14 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#617067]">Usage</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-.04em] sm:text-5xl">用量清楚，阅读不中断。</h1>
          <p className="mt-5 text-base leading-7 text-[#5c6961]">查词与重型功能分开计算。缓存命中、失败、超时和及时取消不扣注册账号额度；1 个深度阅读点约对应 1,000 个待处理字符，摘要至少 2 点，OCR 每张 5 点。</p>
        </section>

        {loading ? <p className="mt-12 text-[#68736c]">正在读取用量…</p> : !account.authenticated ? (
          <section className="mt-12 rounded-[28px] border border-black/10 bg-[#fbfbf8] p-7 sm:p-9">
            <h2 className="text-2xl font-semibold">当前为游客</h2>
            <p className="mt-3 text-[#617067]">每天可试用 10 次划词解释；保存文章、生词本、全文翻译和 OCR 需要登录。</p>
            {account.usage.map((usage) => <UsageBar key={usage.metricKey} usage={usage} />)}
            <button className="mt-7 rounded-full bg-[#18211d] px-6 py-3 font-semibold text-white" type="button" onClick={() => openLogin("登录后会合并本机试用中产生的解释缓存，并开启跨设备同步。")}>手机号登录</button>
          </section>
        ) : (
          <>
            <section className="mt-12 rounded-[28px] border border-black/10 bg-[#fbfbf8] p-7 sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div><p className="text-sm text-[#617067]">当前账号</p><h2 className="mt-1 text-2xl font-semibold">{account.profile?.nickname || accountIdentifier}</h2><p className="mt-2 text-sm text-[#617067]">{accountIdentifier}</p>{account.profile?.loginMethod === "phone_pin" && <p className="mt-1 text-xs text-[#7a847d]">手机号尚未验证 · 6 位数字密码登录</p>}</div>
                <span className="rounded-full bg-[#e8f0e9] px-4 py-2 text-sm font-semibold text-[#355342]">{account.plan?.displayName || "免费用户"}</span>
              </div>
              <div className="mt-8 grid gap-5 sm:grid-cols-2">{account.usage.map((usage) => <UsageBar key={usage.metricKey} usage={usage} />)}</div>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold" type="button" onClick={() => void syncNow()}>立即同步</button>
                <button className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold" type="button" onClick={() => void exportData()}>导出个人数据</button>
                <button className="rounded-full border border-[#9b5353]/25 bg-transparent px-5 py-2.5 text-sm font-semibold text-[#854343] disabled:cursor-wait disabled:opacity-55" type="button" disabled={loggingOut} onClick={() => void handleLogout()}>{loggingOut ? "正在同步并退出…" : "退出登录"}</button>
                <span className="text-xs text-[#748078]">云端为准；冲突时保留本地恢复副本。</span>
              </div>
              {logoutError && <p className="mt-4 text-sm text-[#963f3f]" role="alert">{logoutError}</p>}
            </section>
          </>
        )}

        <section className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#617067]">Plans</p><h2 className="mt-2 text-3xl font-semibold">待验证套餐</h2></div><span className="rounded-full border border-[#ad7b2b]/25 bg-[#fff6e6] px-4 py-2 text-sm text-[#7b5821]">暂不开放在线支付</span></div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68736c]">价格与额度均由后台配置。公开测试期由管理员手动分配套餐，积累真实成本和阅读频率后再接支付。</p>
          <div className="mt-7 grid gap-4 md:grid-cols-2">{plans.map(([name, price, detail]) => <article key={name} className="rounded-3xl border border-black/10 bg-white p-6"><div className="flex items-center justify-between"><h3 className="text-xl font-semibold">{name}</h3><strong>{price}</strong></div><p className="mt-5 text-sm leading-6 text-[#627068]">{detail}</p></article>)}</div>
        </section>
      </div>
    </main>
  );
}

function UsageBar({ usage }: { usage: { metricKey: UsageMetricKey; used: number; allowance: number; remaining: number; windowEnd: string } }) {
  const ratio = usage.allowance > 0 ? Math.min(100, Math.round((usage.used / usage.allowance) * 100)) : 0;
  return <div className="mt-6 first:mt-0"><div className="flex items-center justify-between text-sm"><span className="font-medium">{metricLabels[usage.metricKey]}</span><span className="text-[#637068]">剩余 {usage.remaining} / {usage.allowance}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e3e8e4]"><div className="h-full rounded-full bg-[#2868ad]" style={{ width: `${ratio}%` }} /></div>{usage.windowEnd && <p className="mt-2 text-xs text-[#7a847d]">{new Date(usage.windowEnd).toLocaleString("zh-CN")} 重置</p>}</div>;
}
