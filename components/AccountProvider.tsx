"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_DATA_CHANGED_EVENT } from "@/lib/accountEvents";
import { syncAccountData } from "@/lib/accountSyncClient";
import type { AccountSessionState } from "@/types/account";

const emptyAccount: AccountSessionState = { configured: true, authenticated: false, profile: null, plan: null, usage: [] };

interface AccountContextValue {
  account: AccountSessionState;
  loading: boolean;
  loginOpen: boolean;
  openLogin: (reason?: string) => void;
  closeLogin: () => void;
  requireAccount: (reason?: string) => boolean;
  refreshAccount: () => Promise<void>;
  logout: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const LOCAL_ACCOUNT_KEYS = [
  "context-reader:articles:v1",
  "context-reader:vocabulary:v1",
  "context-reader:explanations:v5",
  "context-reader:article-translations:v1",
  "context-reader:article-translation-blocks:v1",
];

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountSessionState>(emptyAccount);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usageNotice, setUsageNotice] = useState("");
  const syncTimer = useRef<number | null>(null);
  const syncing = useRef(false);

  const refreshAccount = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const data = await response.json() as { account?: AccountSessionState };
    const nextAccount = data.account ?? emptyAccount;
    setAccount(nextAccount);
    if (nextAccount.authenticated) {
      const low = nextAccount.usage.find((item) => item.allowance > 0 && item.remaining / item.allowance <= 0.2);
      setUsageNotice(low ? (low.remaining === 0 ? "本周期额度已用完，可前往用量页查看。" : `额度剩余 ${low.remaining} / ${low.allowance}，已低于 20%。`) : "");
    } else {
      setUsageNotice("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  const syncNow = useCallback(async () => {
    if (!account.authenticated || syncing.current) return;
    syncing.current = true;
    try {
      await syncAccountData();
      await refreshAccount();
    } finally {
      syncing.current = false;
    }
  }, [account.authenticated, refreshAccount]);

  useEffect(() => {
    if (!account.authenticated) return;
    void syncNow();
    const schedule = () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void syncNow(), 1800);
    };
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, schedule);
    window.addEventListener("storage", schedule);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, schedule);
      window.removeEventListener("storage", schedule);
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, [account.authenticated, syncNow]);

  useEffect(() => {
    document.documentElement.classList.toggle("cr-overlay-locked", loginOpen);
    document.body.classList.toggle("cr-overlay-locked", loginOpen);
    return () => {
      document.documentElement.classList.remove("cr-overlay-locked");
      document.body.classList.remove("cr-overlay-locked");
    };
  }, [loginOpen]);

  const openLogin = useCallback((reason = "") => {
    setLoginReason(reason);
    setMessage("");
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => { if (!submitting) setLoginOpen(false); }, [submitting]);
  const requireAccount = useCallback((reason = "此操作需要登录") => {
    if (account.authenticated) return true;
    openLogin(reason);
    return false;
  }, [account.authenticated, openLogin]);

  async function submitEmail() {
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "验证码发送失败。");
      setStep("otp");
      setMessage("验证码已发送，请查看邮箱。验证码有效期由账号服务配置决定。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "验证码发送失败。"); }
    finally { setSubmitting(false); }
  }

  async function submitOtp() {
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, token: otp }),
      });
      const data = await response.json() as { account?: AccountSessionState; error?: string };
      if (!response.ok || !data.account) throw new Error(data.error || "验证码无效或已过期。");
      setAccount(data.account);
      setLoginOpen(false); setStep("email"); setOtp(""); setMessage("");
      window.setTimeout(() => void syncAccountData().then(refreshAccount).catch(() => undefined), 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : "登录失败。"); }
    finally { setSubmitting(false); }
  }

  const logout = useCallback(async () => {
    await syncAccountData();
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("退出失败，请稍后重试。");
    for (const key of LOCAL_ACCOUNT_KEYS) window.localStorage.removeItem(key);
    setAccount(emptyAccount);
    window.location.href = "/";
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    account, loading, loginOpen, openLogin, closeLogin, requireAccount, refreshAccount, logout, syncNow,
  }), [account, loading, loginOpen, openLogin, closeLogin, requireAccount, refreshAccount, logout, syncNow]);

  return (
    <AccountContext.Provider value={value}>
      {children}
      {usageNotice && !loginOpen && <div className="fixed bottom-4 left-1/2 z-[150] flex w-[min(92vw,520px)] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm text-[#34443a] shadow-xl"><span>{usageNotice} <Link className="font-semibold text-[#2868ad]" href="/account/usage">查看用量</Link></span><button className="shrink-0 rounded-full px-2 py-1 text-xs hover:bg-black/5" type="button" onClick={() => setUsageNotice("")}>关闭</button></div>}
      {loginOpen && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-[#152018]/35 px-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLogin(); }}>
          <section className="w-full max-w-[430px] rounded-[28px] border border-black/10 bg-[#fbfbf8] p-7 text-[#18211d] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
            <div className="flex items-start justify-between gap-6">
              <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#617067]">Context Reader Account</p><h2 id="account-login-title" className="mt-2 text-2xl font-semibold">{step === "email" ? "邮箱验证码登录" : "输入验证码"}</h2></div>
              <button className="rounded-full px-3 py-1.5 text-sm hover:bg-black/5" type="button" onClick={closeLogin}>关闭</button>
            </div>
            {loginReason && <p className="mt-5 rounded-2xl bg-[#edf3ee] px-4 py-3 text-sm leading-6 text-[#3f5146]">{loginReason}</p>}
            {!account.configured && <p className="mt-4 rounded-2xl bg-[#fff4df] px-4 py-3 text-sm leading-6 text-[#76531f]">账号数据库尚未连接。站点仍可阅读并使用本机游客试用；完成 Supabase 环境变量与数据库迁移后即可登录。</p>}
            {step === "email" ? (
              <label className="mt-6 block text-sm font-medium">邮箱地址<input className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad]" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitEmail(); }} placeholder="name@example.com" /></label>
            ) : (
              <label className="mt-6 block text-sm font-medium">邮箱验证码<input className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-lg tracking-[.25em] outline-none focus:border-[#2868ad]" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 12))} onKeyDown={(event) => { if (event.key === "Enter") void submitOtp(); }} placeholder="000000" /></label>
            )}
            {message && <p className="mt-4 text-sm leading-6 text-[#8a3d34]" role="status">{message}</p>}
            <button className="mt-6 w-full rounded-full bg-[#18211d] px-5 py-3.5 font-semibold text-white disabled:opacity-50" disabled={!account.configured || submitting || (step === "email" ? !email.trim() : otp.length < 6)} type="button" onClick={() => void (step === "email" ? submitEmail() : submitOtp())}>{submitting ? "请稍候…" : step === "email" ? "发送验证码" : "登录并同步"}</button>
            {step === "otp" && <button className="mt-3 w-full rounded-full px-5 py-2 text-sm text-[#4f6157] hover:bg-black/5" type="button" onClick={() => { setStep("email"); setOtp(""); setMessage(""); }}>更换邮箱</button>}
            <p className="mt-5 text-xs leading-5 text-[#738078]">首次验证会自动创建账号。阅读不会被登录弹窗打断；只在查词额度用完或触发保存、全文翻译等受限操作时提示。</p>
          </section>
        </div>
      )}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside AccountProvider.");
  return value;
}

export function AccountNav() {
  const { account, loading, openLogin, logout } = useAccount();
  const [open, setOpen] = useState(false);
  if (loading) return <span className="text-sm text-black/45">账号</span>;
  if (!account.authenticated) return <button className="cr-nav-primary" type="button" onClick={() => openLogin("登录后可跨设备同步生词本、文章和翻译缓存。")}>登录</button>;
  const label = account.profile?.nickname || account.profile?.email.split("@")[0] || "账号";
  return (
    <span className="relative">
      <button className="cr-nav-primary" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{label}</button>
      {open && <span className="absolute right-0 top-[calc(100%+10px)] z-50 grid w-52 gap-1 rounded-2xl border border-black/10 bg-[#fbfbf8] p-2 text-left text-sm shadow-xl">
        <span className="px-3 py-2 text-xs text-[#6c786f]">{account.plan?.displayName || "当前套餐"}</span>
        <Link className="rounded-xl px-3 py-2 hover:bg-black/5" href="/account/usage">用量与套餐</Link>
        <button className="rounded-xl px-3 py-2 text-left hover:bg-black/5" type="button" onClick={() => void logout().catch((error) => window.alert(error instanceof Error ? error.message : "退出失败"))}>退出登录</button>
      </span>}
    </span>
  );
}
