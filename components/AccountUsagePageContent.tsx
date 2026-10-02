"use client";

import { getLearningStorage, isLearningStorage, LEARNING_STORAGE_EVENT, type LearningStorageStatus } from "@/lib/learningStorage";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { SiteBackdrop } from "@/components/SiteBackdrop";
import type { AccountSyncProgress, AccountSyncResult } from "@/lib/accountSyncClient";
import { BillingDialog } from "@/components/BillingPage";
import { accountPasswordRequirement, isStrongAccountPassword } from "@/lib/passwordPolicy";
import { usageMetricLabels, usageResetLabel } from "@/lib/usagePresentation";
import type { UsageMetricKey } from "@/types/account";


const entitlementExpiryFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function AccountUsagePageContent({ embedded = false }: { embedded?: boolean }) {
  const { account, loading, isOffline, localAccount, openLogin, refreshAccount, syncNow, logout } = useAccount();
  const [localStorageStatus, setLocalStorageStatus] = useState<LearningStorageStatus | null>(null);
  useEffect(() => {
    const changed = (event: Event) => setLocalStorageStatus((event as CustomEvent<LearningStorageStatus>).detail);
    window.addEventListener(LEARNING_STORAGE_EVENT, changed);
    try { const storage = getLearningStorage(); if (isLearningStorage(storage)) { setLocalStorageStatus(storage.status); void storage.estimate(); } } catch {}
    return () => window.removeEventListener(LEARNING_STORAGE_EVENT, changed);
  }, []);
  const [billingOpen, setBillingOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [syncProgress, setSyncProgress] = useState<AccountSyncProgress | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<AccountSyncResult | null>(null);

  const [accountDetailsEditing, setAccountDetailsEditing] = useState(false);
  const [accountDetailsSaving, setAccountDetailsSaving] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountDetailsMessage, setAccountDetailsMessage] = useState("");
  const accountIdentifier = account.profile?.phone
    ? `手机号 ${account.profile.phone}`
    : account.profile?.email || "";
  const activeInvite = account.entitlement?.source === "invite"
    && Boolean(account.entitlement.endsAt)
    && Date.parse(account.entitlement.endsAt || "") > Date.now();
  const visibleUsage = account.usage.filter((usage) => usage.metricKey !== "deep_reading" && usage.metricKey !== "guest_lookup");
  useEffect(() => { void refreshAccount(); }, [refreshAccount]);
  useEffect(() => { setNicknameDraft(account.profile?.nickname || ""); }, [account.profile?.nickname]);

  async function saveAccountDetails() {
    if (accountDetailsSaving) return;
    const nicknameChanged = nicknameDraft.trim() !== (account.profile?.nickname || "");
    const passwordChanged = Boolean(currentPassword || newPassword || confirmPassword);
    if (!nicknameChanged && !passwordChanged) {
      setAccountDetailsEditing(false);
      return;
    }
    if (passwordChanged && (!isStrongAccountPassword(newPassword) || newPassword !== confirmPassword || !currentPassword)) {
      setAccountDetailsMessage(!currentPassword
        ? "请输入当前密码。"
        : newPassword !== confirmPassword ? "两次输入的新密码不一致。" : accountPasswordRequirement());
      return;
    }
    setAccountDetailsSaving(true);
    setAccountDetailsMessage("");
    try {
      if (nicknameChanged) {
        const response = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: nicknameDraft }),
        });
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(data?.error || "昵称暂时无法修改。");
      }
      if (passwordChanged) {
        const response = await fetch("/api/account/password", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(data?.error || "密码暂时无法修改。");
      }
      await refreshAccount();
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setAccountDetailsEditing(false);
      setAccountDetailsMessage(passwordChanged ? "账号资料与密码已保存。" : "昵称已保存。");
    } catch (error) {
      setAccountDetailsMessage(error instanceof Error ? error.message : "账号资料暂时无法保存。");
    } finally {
      setAccountDetailsSaving(false);
    }
  }

  async function handleSync() {
    if (syncStatus === "working") return;
    setSyncStatus("working");
    setSyncError("");
    setSyncProgress(null);
    setLastSyncResult(null);
    try {
      const result = await syncNow({ reconcile: true, onProgress: setSyncProgress });
      setLastSyncResult(result);
      setSyncStatus("success");
    } catch (error) {
      setSyncError(error instanceof TypeError
        ? "暂时无法连接同步服务，本机数据已保留，请稍后重试。"
        : `同步未完成，本机数据已保留。${error instanceof Error ? error.message : "请稍后重试。"}`);
      setSyncStatus("error");
    }
  }

  const syncButtonLabel = syncStatus !== "working"
    ? syncStatus === "success" ? "再次检查同步" : "立即同步"
    : syncProgress?.phase === "waiting"
      ? "正在等待同步…"
      : syncProgress?.phase === "pulling"
        ? syncProgress.initial ? `首次校准 ${syncProgress.pulledCount} 项…` : `正在接收 ${syncProgress.pulledCount} 项…`
        : syncProgress?.phase === "merging"
          ? "正在合并数据…"
          : syncProgress?.phase === "pushing"
            ? `正在上传 ${syncProgress.pushedCount} 项…`
            : "正在同步…";

  const syncResultText = lastSyncResult
    ? lastSyncResult.verified
      ? `已逐项校准：${lastSyncResult.articleCount} 篇文章、${lastSyncResult.vocabularyCount} 个生词与云端一致。`
      : lastSyncResult.pulledCount === 0 && lastSyncResult.pushedCount === 0
      ? `已是最新，用时 ${(lastSyncResult.durationMs / 1000).toFixed(1)} 秒。`
      : `同步完成：接收 ${lastSyncResult.pulledCount} 项，上传 ${lastSyncResult.pushedCount} 项，用时 ${(lastSyncResult.durationMs / 1000).toFixed(1)} 秒。`
    : "";

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
    <main
      className={`${embedded ? "min-h-0" : "cr-site-background"} cr-account-usage px-4 py-8 text-[#17212b] sm:px-6 sm:py-12`}
      data-embedded={embedded || undefined}
    >
      {!embedded && <SiteBackdrop />}
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center gap-4">
          <Link className="text-lg font-semibold" href="/">Context Reader</Link>
        </header>

        <section className="cr-account-intro mt-14 max-w-2xl">
          <h1 className="cr-account-title text-4xl font-semibold tracking-[-.04em] sm:text-5xl">账号与用量</h1>
          <p className="mt-4 text-sm text-[#657582]">把时间留给阅读。</p>
        </section>

        {loading ? <p className="cr-account-state mt-12 text-[#657582]">正在读取账号…</p> : isOffline ? (
          <section className="cr-account-state mt-12 rounded-[16px] bg-[#fff7df] p-7 text-[#533d17] shadow-[0_4px_8px_rgb(69_48_12_/_12%)] sm:p-9">
            <h2 className="text-2xl font-semibold">当前为离线访问</h2>
            <p className="mt-3 leading-7">
              {localAccount?.nickname ? `${localAccount.nickname} 的本机文章、生词和已有缓存仍可使用。` : "当前页面与已缓存内容仍可使用。"}
              {" "}云同步、账号操作和数据导出会在恢复联网后可用。
            </p>
          </section>
        ) : !account.authenticated ? (
          <section className="cr-account-state mt-12 rounded-[16px] bg-[#fbfcfe] p-7 shadow-[0_4px_8px_rgb(43_61_77_/_10%)] sm:p-9">
            <h2 className="text-2xl font-semibold">当前为游客</h2>
            <p className="mt-3 text-[#5f6d79]">保存文章、生词本和私有全文翻译需要登录。</p>
            {visibleUsage.map((usage) => <UsageBar key={usage.metricKey} usage={usage} />)}
            <button className="cr-account-login mt-7 rounded-full bg-[#174f82] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#123f68]" type="button" onClick={() => openLogin("登录后会合并本机试用中产生的解释缓存，并开启跨设备同步。")}>手机号登录</button>
          </section>
        ) : (
          <>
            <section className="cr-account-state mt-12 rounded-[16px] bg-[#fbfcfe] p-7 shadow-[0_4px_8px_rgb(43_61_77_/_10%)] sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div><p className="text-sm text-[#5f6d79]">当前账号</p><h2 className="mt-1 text-2xl font-semibold">{account.profile?.nickname || accountIdentifier}</h2><p className="mt-2 text-sm text-[#5f6d79]">{accountIdentifier}</p>{!account.localOnly && <button className="mt-3 text-xs font-medium text-[#567080] underline decoration-[#9aadb7] underline-offset-4" type="button" onClick={() => { setAccountDetailsEditing((value) => !value); setAccountDetailsMessage(""); }}>{accountDetailsEditing ? "收起账号资料" : "修改账号资料"}</button>}</div>
                <span className="rounded-full bg-[#dce9f3] px-4 py-2 text-sm font-semibold text-[#285a7c]">
                  {activeInvite ? `${account.plan?.displayName || "内测"} 内测` : account.plan?.displayName || "免费账号"}
                </span>
              </div>
              {accountDetailsEditing && !account.localOnly && (
                <div className="mt-7 max-w-2xl border-t border-black/10 pt-6">
                  <label className="block text-sm font-medium">昵称<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad]" value={nicknameDraft} maxLength={40} onChange={(event) => setNicknameDraft(event.target.value)} /></label>
                  <details className="mt-5">
                    <summary className="w-fit cursor-pointer text-sm font-medium text-[#536f80]">修改密码</summary>
                    <p className="mt-2 text-xs leading-5 text-[#738391]">{accountPasswordRequirement()}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <input className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#2868ad]" type="password" autoComplete="current-password" placeholder="当前密码" value={currentPassword} maxLength={72} onChange={(event) => setCurrentPassword(event.target.value)} />
                      <input className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#2868ad]" type="password" autoComplete="new-password" placeholder="新密码" value={newPassword} maxLength={72} onChange={(event) => setNewPassword(event.target.value)} />
                      <input className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#2868ad]" type="password" autoComplete="new-password" placeholder="确认新密码" value={confirmPassword} maxLength={72} onChange={(event) => setConfirmPassword(event.target.value)} />
                    </div>
                  </details>
                  <div className="mt-5 flex items-center gap-3"><button className="rounded-full bg-[#174f82] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={accountDetailsSaving || !nicknameDraft.trim()} onClick={() => void saveAccountDetails()}>{accountDetailsSaving ? "保存中…" : "保存账号资料"}</button><span className="text-xs text-[#738391]">手机号不可在这里修改</span></div>
                </div>
              )}
              {accountDetailsMessage && <p className="mt-4 text-sm text-[#315e66]" role="status">{accountDetailsMessage}</p>}
              {activeInvite && account.entitlement?.endsAt && <p className="mt-5 rounded-xl bg-[#edf5fb] px-4 py-3 text-sm leading-6 text-[#174d73]">邀请码权益有效期至 {entitlementExpiryFormatter.format(new Date(account.entitlement.endsAt))}，到期后自动恢复免费档位；届时可以继续兑换新的邀请码。</p>}
              {account.localOnly ? (
                <p className="mt-7 max-w-2xl text-sm leading-6 text-[#526b5a]">这是仅限 <code>127.0.0.1 / localhost</code> 的本机开发者身份。保存文章、生词本、阅读进度与缓存会持续保存在当前浏览器；它不会访问 Vercel 或云端账号服务，也不会自动同步到其他设备。</p>
              ) : (
                <>
                  {account.localDirect && <p className="mt-7 max-w-2xl text-sm leading-6 text-[#526b5a]">当前 localhost 已固定连接到真实的 galio 开发者账号。保存文章、生词本、阅读进度和缓存会继续与 Supabase 云端同步；本地开发不会访问或部署到 Vercel。</p>}
                  {<div className="mt-8 grid gap-5">{visibleUsage.map((usage) => <UsageBar key={usage.metricKey} usage={usage} />)}</div>}
                  {account.plan?.id !== "admin" && <div className="mt-6"><button type="button" className="rounded-full bg-[#273b32] px-6 py-3 text-sm font-semibold text-white" onClick={() => setBillingOpen(true)}>升级账号</button><button type="button" className="ml-4 text-sm text-[#536f80] underline underline-offset-4" onClick={() => setBillingOpen(true)}>套餐与订单</button></div>}
                  {account.entitlement?.source === "payment" && account.entitlement.endsAt && <p className="mt-4 text-sm text-[#657582]">会员有效期至 {entitlementExpiryFormatter.format(new Date(account.entitlement.endsAt))} · 不自动续费</p>}
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <button className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold transition-[transform,background-color,opacity] hover:bg-[#edf5fb] active:scale-[.97] disabled:cursor-wait disabled:opacity-55" type="button" onClick={() => void handleSync()} disabled={syncStatus === "working"} aria-busy={syncStatus === "working"}>{syncButtonLabel}</button>

                    {!account.localDirect && <button className="rounded-full border border-[#9b5353]/25 bg-transparent px-5 py-2.5 text-sm font-semibold text-[#854343] disabled:cursor-wait disabled:opacity-55" type="button" disabled={loggingOut} onClick={() => void handleLogout()}>{loggingOut ? "正在同步并退出…" : "退出登录"}</button>}
                  </div>
                  {syncResultText && <p className="mt-4 text-sm font-medium text-[#35634a]" role="status" aria-live="polite">{syncResultText}</p>}
                  {syncStatus === "error" && <p className="mt-4 text-sm text-[#963f3f]" role="alert">{syncError}</p>}
                  {localStorageStatus?.usage !== undefined && <p className="mt-3 text-xs text-[#526b5a]">本机网站数据约 {(localStorageStatus.usage / 1024 / 1024).toFixed(1)} MB，文章和生词会保留，历史释义缓存按上限管理。</p>}
                  {Boolean(localStorageStatus?.quota && localStorageStatus.usage && localStorageStatus.usage / localStorageStatus.quota > 0.8) && <p className="mt-2 text-sm text-[#963f3f]">本机网站空间接近上限，请在离线恢复工具中备份数据。</p>}
                  {logoutError && <p className="mt-4 text-sm text-[#963f3f]" role="alert">{logoutError}</p>}
                </>
              )}
            </section>
          </>
        )}

        {billingOpen && <BillingDialog onClose={() => setBillingOpen(false)} />}
      </div>
    </main>
  );
}

function UsageBar({ usage }: { usage: { metricKey: UsageMetricKey; used: number; allowance: number; remaining: number; windowEnd: string } }) {
  const ratio = usage.allowance > 0 ? Math.min(100, Math.round((usage.used / usage.allowance) * 100)) : 0;
  return <div className="mt-6 first:mt-0"><div className="flex items-center justify-between text-sm"><span className="font-medium">{usageMetricLabels[usage.metricKey] || "其他功能"}</span><span className="text-[#60717f]">已用 {usage.used.toLocaleString()} / {usage.allowance.toLocaleString()}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dce5ec]"><div className="h-full rounded-full bg-[#2b6eaa]" style={{ width: `${ratio}%` }} /></div>{usage.windowEnd && <p className="mt-2 text-xs text-[#738391]">{usageResetLabel(usage.windowEnd)} 更新额度</p>}</div>;
}
