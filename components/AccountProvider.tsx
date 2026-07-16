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

const LOGOUT_SYNC_TIMEOUT_MS = 12_000;

async function waitForLogoutSync(): Promise<void> {
  let timeoutId: number | null = null;
  try {
    await Promise.race([
      syncAccountData().then(() => undefined),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("同步时间过长，尚未退出。请检查网络后重试。")), LOGOUT_SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountSessionState>(emptyAccount);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
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

  useEffect(() => {
    async function bootstrapAccount() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const authError = hash.get("error_description") || hash.get("error");

      if (accessToken && refreshToken) {
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
        try {
          const response = await fetch("/api/auth/adopt-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken, refreshToken }),
          });
          const data = await response.json() as { account?: AccountSessionState; error?: string };
          if (!response.ok || !data.account) throw new Error(data.error || "登录链接无效或已过期。");
          setAccount(data.account);
          setMessage("");
        } catch (error) {
          setLoginOpen(true);
          setMessage(error instanceof Error ? error.message : "登录失败，请重新获取登录邮件。");
        }
      } else if (authError) {
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
        setLoginOpen(true);
        setMessage(decodeURIComponent(authError.replace(/\+/g, " ")));
      }

      await refreshAccount();
    }

    void bootstrapAccount();
  }, [refreshAccount]);

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
    if (
      window.location.pathname.startsWith("/admin") ||
      window.location.pathname === "/account/repair-vocabulary"
    ) return;
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
    setLoginMode("login");
    setPhone("");
    setNickname("");
    setPin("");
    setConfirmPin("");
    setShowPin(false);
    setMessage("");
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => {
    if (submitting) return;
    setLoginOpen(false);
    setLoginReason("");
    setPhone("");
    setNickname("");
    setPin("");
    setConfirmPin("");
    setMessage("");
  }, [submitting]);
  const requireAccount = useCallback((reason = "此操作需要登录") => {
    if (account.authenticated) return true;
    openLogin(reason);
    return false;
  }, [account.authenticated, openLogin]);

  async function submitPhoneAccount() {
    if (loginMode === "register" && pin !== confirmPin) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch(loginMode === "register" ? "/api/auth/phone-register" : "/api/auth/phone-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginMode === "register" ? { phone, nickname, pin } : { phone, pin }),
      });
      const data = await response.json() as { account?: AccountSessionState; error?: string };
      if (!response.ok || !data.account) throw new Error(data.error || (loginMode === "register" ? "注册失败。" : "登录失败。"));
      setAccount(data.account);
      setLoginOpen(false);
      setPhone("");
      setNickname("");
      setPin("");
      setConfirmPin("");
      setMessage("");
      window.setTimeout(() => void syncAccountData().then(refreshAccount).catch(() => undefined), 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : "登录失败。"); }
    finally { setSubmitting(false); }
  }

  const logout = useCallback(async () => {
    await waitForLogoutSync();
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
          <section className="w-full max-w-[430px] rounded-[24px] border border-black/10 bg-[#fbfbf8] p-7 text-[#18211d] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
            <div className="flex items-start justify-between gap-6">
              <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#617067]">Context Reader Account</p><h2 id="account-login-title" className="mt-2 text-2xl font-semibold">{loginMode === "login" ? "手机号登录" : "创建账号"}</h2></div>
              <button className="rounded-full px-3 py-1.5 text-sm hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2868ad]" type="button" onClick={closeLogin}>关闭</button>
            </div>
            {loginReason && <p className="mt-5 rounded-2xl bg-[#edf3ee] px-4 py-3 text-sm leading-6 text-[#3f5146]">{loginReason}</p>}
            {!account.configured && <p className="mt-4 rounded-2xl bg-[#fff4df] px-4 py-3 text-sm leading-6 text-[#76531f]">账号数据库尚未连接。站点仍可阅读并使用本机游客试用；完成 Supabase 环境变量与数据库迁移后即可登录。</p>}
            <div className="mt-6 grid grid-cols-2 rounded-xl bg-[#e9ede9] p-1" aria-label="登录或注册">
              <button className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${loginMode === "login" ? "bg-white text-[#18211d] shadow-sm" : "text-[#5f6c64]"}`} type="button" aria-pressed={loginMode === "login"} onClick={() => { setLoginMode("login"); setNickname(""); setConfirmPin(""); setMessage(""); }}>登录</button>
              <button className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${loginMode === "register" ? "bg-white text-[#18211d] shadow-sm" : "text-[#5f6c64]"}`} type="button" aria-pressed={loginMode === "register"} onClick={() => { setLoginMode("register"); setMessage(""); }}>注册</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void submitPhoneAccount(); }}>
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">昵称<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="text" autoComplete="nickname" maxLength={40} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例如：小林" /></label>}
              <label className="mt-5 block text-sm font-medium">手机号<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+\s()-]/g, "").slice(0, 24))} placeholder="中国大陆手机号" /></label>
              <label className="mt-5 block text-sm font-medium">6 位数字密码<span className="relative mt-2 block"><input className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 pr-16 text-lg tracking-[.22em] outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type={showPin ? "text" : "password"} inputMode="numeric" autoComplete={loginMode === "login" ? "current-password" : "new-password"} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /><button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1.5 text-xs text-[#526158] hover:bg-black/5" type="button" onClick={() => setShowPin((value) => !value)} aria-label={showPin ? "隐藏密码" : "显示密码"}>{showPin ? "隐藏" : "显示"}</button></span></label>
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">确认密码<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-lg tracking-[.22em] outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="再次输入" /></label>}
              {message && <p className="mt-4 text-sm leading-6 text-[#8a3d34]" role="status">{message}</p>}
              <button className="mt-6 w-full rounded-full bg-[#18211d] px-5 py-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2868ad] disabled:cursor-not-allowed disabled:opacity-50" disabled={!account.configured || submitting || phone.trim().length < 11 || pin.length !== 6 || (loginMode === "register" && (!nickname.trim() || confirmPin.length !== 6))} type="submit">{submitting ? "请稍候…" : loginMode === "login" ? "登录并同步" : "创建账号并登录"}</button>
            </form>
            <p className="mt-5 text-xs leading-5 text-[#738078]">手机号目前只作为登录账号，不发送验证码，也尚未验证归属。请记住密码；忘记后需联系管理员重置。阅读只会在触发受限操作时提示登录。</p>
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出失败，请稍后重试。");
      setLoggingOut(false);
    }
  }

  if (loading) return <span className="text-sm text-black/45">账号</span>;
  if (!account.authenticated) return <button className="cr-nav-primary" type="button" onClick={() => openLogin("登录后可跨设备同步生词本、文章和翻译缓存。")}>登录</button>;
  const label = account.profile?.nickname || account.profile?.email.split("@")[0] || "账号";
  return (
    <span className="relative">
      <button className="cr-nav-primary" type="button" onClick={() => { setOpen((value) => !value); setLogoutError(""); }} aria-expanded={open}>{label}</button>
      {open && <span className="absolute right-0 top-[calc(100%+10px)] z-50 grid w-60 gap-1 rounded-2xl border border-black/10 bg-[#fbfbf8] p-2 text-left text-sm shadow-xl">
        <span className="px-3 py-2 text-xs text-[#6c786f]">{account.plan?.displayName || "当前套餐"}</span>
        <Link className="rounded-xl px-3 py-2 hover:bg-black/5" href="/account/usage">用量与套餐</Link>
        <button className="rounded-xl px-3 py-2 text-left hover:bg-black/5 disabled:cursor-wait disabled:text-black/45" type="button" disabled={loggingOut} onClick={() => void handleLogout()}>{loggingOut ? "正在同步并退出…" : "退出登录"}</button>
        {logoutError && <span className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" role="alert">{logoutError}</span>}
      </span>}
    </span>
  );
}
