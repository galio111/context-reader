"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ClearableField from "@/components/ClearableField";
import { ACCOUNT_DATA_CHANGED_EVENT } from "@/lib/accountEvents";
import { describeApiFailure, describeCaughtRequestError } from "@/lib/clientErrorReporting";
import {
  clearLocalAccountData,
  prepareLocalAccountForUser,
  syncAccountData,
  type AccountSyncOptions,
  type AccountSyncResult,
} from "@/lib/accountSyncClient";
import {
  clearLocalAccountSession,
  readLocalAccountSession,
  rememberLocalAccountSession,
  type LocalAccountSession,
} from "@/lib/localAccountSession";
import type { AccountSessionState } from "@/types/account";
import {
  accountPasswordRequirement,
  isAcceptedAccountLoginPassword,
  isStrongAccountPassword,
} from "@/lib/passwordPolicy";

const emptyAccount: AccountSessionState = { configured: true, authenticated: false, profile: null, plan: null, usage: [] };

interface AccountContextValue {
  account: AccountSessionState;
  loading: boolean;
  isOffline: boolean;
  hasLocalAccountAccess: boolean;
  localAccount: LocalAccountSession | null;
  loginOpen: boolean;
  openLogin: (reason?: string) => void;
  closeLogin: () => void;
  requireAccount: (reason?: string) => boolean;
  requireLocalAccount: (reason?: string) => boolean;
  refreshAccount: () => Promise<ConnectionResult>;
  logout: () => Promise<void>;
  syncNow: (options?: AccountSyncOptions) => Promise<AccountSyncResult>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const LOGOUT_SYNC_TIMEOUT_MS = 12_000;
const ACCOUNT_SESSION_TIMEOUT_MS = 8_000;
const CONNECTIVITY_TIMEOUT_MS = 5_000;
const OFFLINE_RECHECK_INTERVAL_MS = 12_000;
const REMOTE_SYNC_INTERVAL_MS = 15_000;
const LOCAL_SYNC_DEBOUNCE_MS = 800;

type ConnectionResult = "online" | "network" | "service";

async function canReachContextReader(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/connectivity?checkedAt=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

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
  const [isOffline, setIsOffline] = useState(false);
  const [offlineReason, setOfflineReason] = useState<Exclude<ConnectionResult, "online">>("network");
  const [localAccount, setLocalAccount] = useState<LocalAccountSession | null>(null);
  const [offlineActionNotice, setOfflineActionNotice] = useState("");
  const [offlineDetailsOpen, setOfflineDetailsOpen] = useState(false);
  const [connectivityChecking, setConnectivityChecking] = useState(false);
  const [connectivityToast, setConnectivityToast] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinTouched, setPinTouched] = useState(false);
  const [confirmPinTouched, setConfirmPinTouched] = useState(false);
  const [passwordInputReady, setPasswordInputReady] = useState(false);
  const [confirmPasswordInputReady, setConfirmPasswordInputReady] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [syncingLogin, setSyncingLogin] = useState(false);
  const [usageNotice, setUsageNotice] = useState("");
  const syncTimer = useRef<number | null>(null);
  const connectivityCheckingRef = useRef(false);
  const connectivityToastTimer = useRef<number | null>(null);

  const announceConnectivity = useCallback((notice: string) => {
    setConnectivityToast(notice);
    if (connectivityToastTimer.current !== null) window.clearTimeout(connectivityToastTimer.current);
    connectivityToastTimer.current = window.setTimeout(() => {
      setConnectivityToast("");
      connectivityToastTimer.current = null;
    }, 3200);
  }, []);

  const refreshAccount = useCallback(async (): Promise<ConnectionResult> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ACCOUNT_SESSION_TIMEOUT_MS);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => null) as { account?: AccountSessionState; unavailable?: boolean } | null;
      if (!response.ok || data?.unavailable) {
        throw new Error("account service unavailable");
      }
      const nextAccount = data?.account ?? emptyAccount;
      setAccount(nextAccount);
      setIsOffline(false);
      setOfflineReason("network");
      setOfflineActionNotice("");
      if (nextAccount.authenticated) {
        const snapshot = rememberLocalAccountSession(nextAccount);
        setLocalAccount(snapshot);
        if ((nextAccount.localOnly || nextAccount.localDirect) && nextAccount.profile?.userId) {
          prepareLocalAccountForUser(nextAccount.profile.userId, { preserveExistingData: true });
        }
        const low = nextAccount.usage.find((item) => item.allowance > 0 && item.remaining / item.allowance <= 0.2);
        setUsageNotice(low ? (low.remaining === 0 ? "本周期额度已用完，可前往用量页查看。" : `额度剩余 ${low.remaining} / ${low.allowance}，已低于 20%。`) : "");
      } else {
        clearLocalAccountSession();
        setLocalAccount(null);
        setUsageNotice("");
      }
      return "online";
    } catch {
      const reason = await canReachContextReader() ? "service" : "network";
      setIsOffline(true);
      setOfflineReason(reason);
      setAccount(emptyAccount);
      setLocalAccount(readLocalAccountSession());
      setUsageNotice("");
      return reason;
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  const runConnectivityCheck = useCallback(async (announce = true) => {
    if (connectivityCheckingRef.current) return;
    connectivityCheckingRef.current = true;
    setConnectivityChecking(true);
    setOfflineActionNotice("正在检查网络与在线服务…");
    try {
      const result = await refreshAccount();
      if (result === "online") {
        if (announce) announceConnectivity("网络已恢复，在线功能现在可以使用。");
      } else if (result === "service") {
        setOfflineActionNotice("网络连接正常，但账号服务暂未响应。我们会继续自动检测。");
      } else {
        setOfflineActionNotice("仍未连接到 Context Reader。请检查网络，我们会继续自动检测。");
      }
    } finally {
      connectivityCheckingRef.current = false;
      setConnectivityChecking(false);
    }
  }, [announceConnectivity, refreshAccount]);

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
          if (!response.ok || !data.account) {
            setLoginOpen(true);
            setMessage(await describeApiFailure(response, data, {
              operation: "account_adopt_session",
              endpoint: "/api/auth/adopt-session",
              fallbackMessage: "登录链接无效或已过期。",
            }));
          } else {
            setAccount(data.account);
            setLocalAccount(rememberLocalAccountSession(data.account));
            setMessage("");
          }
        } catch (error) {
          setLoginOpen(true);
          setMessage(await describeCaughtRequestError(error, {
            operation: "account_adopt_session",
            endpoint: "/api/auth/adopt-session",
            fallbackMessage: "登录失败，请重新获取登录邮件。",
          }));
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

  useEffect(() => {
    const markOffline = () => {
      setIsOffline(true);
      setOfflineReason("network");
      setAccount(emptyAccount);
      setLocalAccount(readLocalAccountSession());
      setUsageNotice("");
      setOfflineActionNotice("检测到网络已断开，本机内容仍可继续使用。");
      setLoading(false);
    };
    const retryOnline = () => {
      setOfflineActionNotice("检测到网络变化，正在确认在线服务…");
      void runConnectivityCheck();
    };

    if (!navigator.onLine) markOffline();
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", retryOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", retryOnline);
    };
  }, [runConnectivityCheck]);

  useEffect(() => {
    if (!isOffline) return;

    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") void runConnectivityCheck();
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void runConnectivityCheck();
    }, OFFLINE_RECHECK_INTERVAL_MS);

    window.addEventListener("focus", retryWhenVisible);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", retryWhenVisible);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [isOffline, runConnectivityCheck]);

  useEffect(() => () => {
    if (connectivityToastTimer.current !== null) window.clearTimeout(connectivityToastTimer.current);
  }, []);

  const syncNow = useCallback(async (options: AccountSyncOptions = {}) => {
    if (!account.authenticated || account.localOnly) {
      throw new Error("当前账号不能使用云同步。");
    }
    if (account.profile?.userId) {
      prepareLocalAccountForUser(account.profile.userId, { preserveExistingData: account.localDirect });
    }
    return syncAccountData(options);
  }, [account.authenticated, account.localDirect, account.localOnly, account.profile?.userId]);

  useEffect(() => {
    if (!account.authenticated || account.localOnly) return;
    if (
      (window.location.pathname.startsWith("/admin") && account.plan?.id !== "admin") ||
      window.location.pathname === "/account/repair-vocabulary"
    ) return;
    void syncNow().catch(() => undefined);
    const scheduleLocalPush = () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        void syncNow().catch(() => undefined);
      }, LOCAL_SYNC_DEBOUNCE_MS);
    };
    const pullRemoteChanges = () => {
      if (document.visibilityState === "visible") void syncNow().catch(() => undefined);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "context-reader:sync-state:v2" || event.key === "context-reader:last-sync:v1") return;
      scheduleLocalPush();
    };
    const intervalId = window.setInterval(pullRemoteChanges, REMOTE_SYNC_INTERVAL_MS);
    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, scheduleLocalPush);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", pullRemoteChanges);
    document.addEventListener("visibilitychange", pullRemoteChanges);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, scheduleLocalPush);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", pullRemoteChanges);
      document.removeEventListener("visibilitychange", pullRemoteChanges);
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, [account.authenticated, account.localOnly, account.plan?.id, syncNow]);

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
    setPinTouched(false);
    setConfirmPinTouched(false);
    setPasswordInputReady(false);
    setConfirmPasswordInputReady(false);
    setMessage("");
    setSyncingLogin(false);
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
    setPinTouched(false);
    setConfirmPinTouched(false);
    setPasswordInputReady(false);
    setConfirmPasswordInputReady(false);
    setMessage("");
    setSyncingLogin(false);
  }, [submitting]);
  const requireAccount = useCallback((reason = "此操作需要登录") => {
    if (account.authenticated) return true;
    if (isOffline) {
      setOfflineActionNotice("当前处于离线状态，这项操作需要联网。你仍可阅读本机文章、查看生词本和使用已有缓存。");
      return false;
    }
    openLogin(reason);
    return false;
  }, [account.authenticated, isOffline, openLogin]);
  const hasLocalAccountAccess = account.authenticated || (isOffline && Boolean(localAccount));
  const requireLocalAccount = useCallback((reason = "此操作需要登录") => {
    if (hasLocalAccountAccess) return true;
    if (isOffline) {
      setOfflineActionNotice("当前离线，且此设备没有可确认的历史账号。联网并登录后才能使用这项功能。");
      return false;
    }
    openLogin(reason);
    return false;
  }, [hasLocalAccountAccess, isOffline, openLogin]);

  async function submitPhoneAccount() {
    setPinTouched(true);
    const credentialValid = loginMode === "login"
      ? isAcceptedAccountLoginPassword(pin)
      : isStrongAccountPassword(pin);
    if (!credentialValid) {
      setMessage(loginMode === "login" ? "请输入注册时设置的密码。" : accountPasswordRequirement());
      return;
    }
    if (loginMode === "register" && !isStrongAccountPassword(confirmPin)) {
      setConfirmPinTouched(true);
      setMessage(accountPasswordRequirement());
      return;
    }
    if (loginMode === "register" && pin !== confirmPin) {
      setConfirmPinTouched(true);
      setMessage("两次输入的密码不一致。");
      return;
    }
    let signedIn = false;
    setSubmitting(true); setSyncingLogin(false); setMessage("");
    try {
      const response = await fetch(loginMode === "register" ? "/api/auth/phone-register" : "/api/auth/phone-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginMode === "register" ? { phone, nickname, pin } : { phone, pin }),
      });
      const data = await response.json() as { account?: AccountSessionState; error?: string };
      if (!response.ok || !data.account) {
        setMessage(await describeApiFailure(response, data, {
          operation: loginMode === "register" ? "phone_register" : "phone_login",
          endpoint: loginMode === "register" ? "/api/auth/phone-register" : "/api/auth/phone-login",
          fallbackMessage: loginMode === "register" ? "注册失败。" : "登录失败。",
        }));
        return;
      }
      signedIn = true;
      setAccount(data.account);
      setIsOffline(false);
      setLocalAccount(rememberLocalAccountSession(data.account));
      if (data.account.profile?.userId) prepareLocalAccountForUser(data.account.profile.userId);
      setSyncingLogin(true);
      await syncAccountData();
      await refreshAccount();
      setLoginOpen(false);
      setPhone("");
      setNickname("");
      setPin("");
      setConfirmPin("");
      setPinTouched(false);
      setConfirmPinTouched(false);
      setPasswordInputReady(false);
      setConfirmPasswordInputReady(false);
      setMessage("");
    } catch (error) {
      const detail = await describeCaughtRequestError(error, {
        operation: signedIn ? "account_sync_after_login" : loginMode === "register" ? "phone_register" : "phone_login",
        endpoint: signedIn ? "/api/account/sync" : loginMode === "register" ? "/api/auth/phone-register" : "/api/auth/phone-login",
        fallbackMessage: signedIn ? "登录后的数据同步失败。" : "登录失败。",
      });
      setMessage(signedIn ? `账号已登录，但数据同步没有完成：${detail} 请检查网络后重试。` : detail);
    }
    finally { setSyncingLogin(false); setSubmitting(false); }
  }

  const logout = useCallback(async () => {
    if (account.localOnly || account.localDirect) {
      window.location.href = "/";
      return;
    }
    try {
      await waitForLogoutSync();
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(await describeApiFailure(response, data, {
          operation: "account_logout",
          endpoint: "/api/auth/logout",
          fallbackMessage: "退出失败，请稍后重试。",
        }));
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("服务暂时不可用")) throw error;
      throw new Error(await describeCaughtRequestError(error, {
        operation: "account_logout",
        endpoint: "/api/auth/logout",
        fallbackMessage: "退出失败，请稍后重试。",
      }));
    }
    clearLocalAccountData();
    clearLocalAccountSession();
    setLocalAccount(null);
    setAccount(emptyAccount);
    window.location.href = "/";
  }, [account.localDirect, account.localOnly]);

  const value = useMemo<AccountContextValue>(() => ({
    account, loading, isOffline, hasLocalAccountAccess, localAccount, loginOpen, openLogin, closeLogin,
    requireAccount, requireLocalAccount, refreshAccount, logout, syncNow,
  }), [
    account, loading, isOffline, hasLocalAccountAccess, localAccount, loginOpen, openLogin, closeLogin,
    requireAccount, requireLocalAccount, refreshAccount, logout, syncNow,
  ]);

  const pinIsValid = loginMode === "login"
    ? isAcceptedAccountLoginPassword(pin)
    : isStrongAccountPassword(pin);
  const pinFeedback = !pinTouched
    ? loginMode === "login" ? "请输入密码。" : accountPasswordRequirement()
    : pinIsValid
      ? "密码格式正确。"
      : pin.length === 0
        ? "请输入密码。"
        : loginMode === "login" ? "请输入注册时设置的密码。" : accountPasswordRequirement();
  const confirmPinIsValid = isStrongAccountPassword(confirmPin) && confirmPin === pin;

  return (
    <AccountContext.Provider value={value}>
      {children}
      {isOffline && (
        <aside
          className="fixed left-1/2 top-2 z-[190] w-[min(94vw,760px)] -translate-x-1/2 rounded-xl bg-[#fff7df] px-3 py-2 text-[#533d17] shadow-[0_4px_8px_rgba(69,48,12,.16)] sm:top-3 sm:px-4 sm:py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 sm:items-start sm:gap-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base">
                {offlineReason === "network" ? "离线模式" : "账号服务暂不可用"}
                {localAccount?.nickname ? ` · ${localAccount.nickname}` : ""}
              </p>
              <div className={`${offlineDetailsOpen ? "block" : "hidden"} sm:block`}>
                <p className="mt-1 text-sm leading-6">
                  {localAccount
                    ? "可阅读和保存本机文章、查看或记录生词、使用已有解释与翻译缓存。"
                    : "可继续阅读当前页面；此设备没有可确认的历史账号，因此账号内容暂不显示。"}
                  <span className="block">新查词、AI 翻译、网址导入、云同步和用量查询需要联网并连接在线服务。</span>
                </p>
                {offlineActionNotice && <p className="mt-1 text-sm font-medium" role="alert">{offlineActionNotice}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                className="rounded-full px-2 py-1 text-xs font-semibold hover:bg-[#684c17]/10 sm:hidden"
                type="button"
                aria-expanded={offlineDetailsOpen}
                onClick={() => setOfflineDetailsOpen((open) => !open)}
              >
                {offlineDetailsOpen ? "收起" : "详情"}
              </button>
              <button
                className="shrink-0 rounded-full bg-[#684c17] px-3 py-1.5 text-xs font-semibold text-white transition-[transform,background-color,opacity] hover:bg-[#543c12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#684c17] active:scale-[.97] disabled:cursor-wait disabled:opacity-65 sm:text-sm"
                type="button"
                disabled={connectivityChecking}
                aria-busy={connectivityChecking}
                onClick={() => void runConnectivityCheck()}
              >
                <span className="sm:hidden">{connectivityChecking ? "检查中…" : "重试"}</span>
                <span className="hidden sm:inline">{connectivityChecking ? "正在检查网络…" : "重新检测网络"}</span>
              </button>
            </div>
          </div>
        </aside>
      )}
      {connectivityToast && (
        <div
          className="fixed bottom-4 left-1/2 z-[195] w-[min(92vw,460px)] -translate-x-1/2 rounded-xl bg-[#173f32] px-4 py-3 text-center text-sm font-medium text-white shadow-[0_4px_8px_rgba(13,49,37,.2)]"
          role="status"
          aria-live="polite"
        >
          {connectivityToast}
        </div>
      )}
      {usageNotice && !loginOpen && <div className="fixed bottom-4 left-1/2 z-[150] flex w-[min(92vw,520px)] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-black/10 bg-[#fbfcfe] px-4 py-3 text-sm text-[#344d5e] shadow-xl"><span>{usageNotice} <Link className="font-semibold text-[#2868ad]" href="/account/usage">查看用量</Link></span><button className="shrink-0 rounded-full px-2 py-1 text-xs hover:bg-black/5" type="button" onClick={() => setUsageNotice("")}>关闭</button></div>}
      {loginOpen && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-[#172d3b]/35 px-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLogin(); }}>
          <section className="max-h-[calc(100dvh-2rem)] w-full max-w-[430px] overflow-y-auto rounded-[16px] bg-[#fbfcfe] p-7 text-[#17212b] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="account-login-title">
            <div className="flex items-start justify-between gap-6">
              <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#5f6d79]">Context Reader Account</p><h2 id="account-login-title" className="mt-2 text-2xl font-semibold">{loginMode === "login" ? "手机号登录" : "创建账号"}</h2></div>
              <button className="rounded-full px-3 py-1.5 text-sm hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2868ad] disabled:cursor-wait disabled:opacity-45" type="button" disabled={submitting} onClick={closeLogin}>关闭</button>
            </div>
            {loginReason && <p className="mt-5 rounded-xl bg-[#e3edf4] px-4 py-3 text-sm leading-6 text-[#405d70]">{loginReason}</p>}
            {!account.configured && <p className="mt-4 rounded-2xl bg-[#fff4df] px-4 py-3 text-sm leading-6 text-[#76531f]">账号数据库尚未连接。站点仍可阅读并使用本机游客试用；完成 Supabase 环境变量与数据库迁移后即可登录。</p>}
            <div className="mt-6 grid grid-cols-2 rounded-xl bg-[#e4ebf1] p-1" aria-label="登录或注册">
              <button className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-wait ${loginMode === "login" ? "bg-white text-[#17212b] shadow-sm" : "text-[#5f6d79]"}`} type="button" disabled={submitting} aria-pressed={loginMode === "login"} onClick={() => { setLoginMode("login"); setNickname(""); setConfirmPin(""); setPin(""); setPinTouched(false); setConfirmPinTouched(false); setPasswordInputReady(false); setConfirmPasswordInputReady(false); setMessage(""); }}>登录</button>
              <button className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-wait ${loginMode === "register" ? "bg-white text-[#17212b] shadow-sm" : "text-[#5f6d79]"}`} type="button" disabled={submitting} aria-pressed={loginMode === "register"} onClick={() => { setLoginMode("register"); setPin(""); setConfirmPin(""); setPinTouched(false); setConfirmPinTouched(false); setPasswordInputReady(false); setConfirmPasswordInputReady(false); setMessage(""); }}>注册</button>
            </div>
            <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void submitPhoneAccount(); }}>
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">昵称<ClearableField className="mt-2" value={nickname} onClear={() => setNickname("")} label="清空昵称"><input className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="text" autoComplete="nickname" maxLength={40} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例如：小林" /></ClearableField></label>}
              <label className="mt-5 block text-sm font-medium">手机号<ClearableField className="mt-2" value={phone} onClear={() => setPhone("")} label="清空手机号"><input className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+\s()-]/g, "").slice(0, 24))} placeholder="中国大陆手机号" /></ClearableField></label>
              <label className="mt-5 block text-sm font-medium">密码
                <ClearableField className="mt-2" value={pin} onClear={() => { setPin(""); setPinTouched(false); setPasswordInputReady(true); }} label="清空密码" clearButtonInset="4.4rem" inputPaddingRight="7rem">
                  <input
                    className={`w-full rounded-xl border bg-white px-4 py-3 pr-16 text-base outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15 ${pinTouched && !pinIsValid ? "border-[#b85a4c]" : "border-black/15"}`}
                    type={showPin ? "text" : "password"}
                    name={`context-reader-${loginMode}-credential`}
                    autoComplete={loginMode === "login" ? "current-password" : "new-password"}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    readOnly={!passwordInputReady}
                    value={pin}
                    aria-describedby="account-password-help"
                    aria-invalid={pinTouched && !pinIsValid}
                    onFocus={(event) => {
                      if (!passwordInputReady) {
                        event.currentTarget.value = "";
                        setPin("");
                        setPasswordInputReady(true);
                      }
                    }}
                    onBlur={() => setPinTouched(true)}
                    onChange={(event) => {
                      setPinTouched(true);
                      setPin(event.target.value.slice(0, 72));
                    }}
                    placeholder={loginMode === "login" ? "输入密码" : "至少 8 位，包含字母和数字"}
                  />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1.5 text-xs text-[#526158] hover:bg-black/5" type="button" onClick={() => { if (!passwordInputReady) { setPin(""); setPasswordInputReady(true); } setShowPin((value) => !value); }} aria-label={showPin ? "隐藏密码" : "显示密码"}>{showPin ? "隐藏" : "显示"}</button>
                </ClearableField>
              </label>
              <p id="account-password-help" className={`mt-2 text-xs leading-5 ${pinTouched && !pinIsValid ? "text-[#a1473b]" : pinIsValid ? "text-[#52705d]" : "text-[#738078]"}`} aria-live="polite">{pinFeedback}</p>
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">确认密码
                <ClearableField className="mt-2" value={confirmPin} onClear={() => { setConfirmPin(""); setConfirmPinTouched(false); setConfirmPasswordInputReady(true); }} label="清空确认密码">
                <input
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15 ${confirmPinTouched && !confirmPinIsValid ? "border-[#b85a4c]" : "border-black/15"}`}
                  type={showPin ? "text" : "password"}
                  name="context-reader-confirm-credential"
                  autoComplete="new-password"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  readOnly={!confirmPasswordInputReady}
                  value={confirmPin}
                  aria-describedby="account-confirm-password-help"
                  aria-invalid={confirmPinTouched && !confirmPinIsValid}
                  onFocus={(event) => {
                    if (!confirmPasswordInputReady) {
                      event.currentTarget.value = "";
                      setConfirmPin("");
                      setConfirmPasswordInputReady(true);
                    }
                  }}
                  onBlur={() => setConfirmPinTouched(true)}
                  onChange={(event) => {
                    setConfirmPinTouched(true);
                    setConfirmPin(event.target.value.slice(0, 72));
                  }}
                  placeholder="再次输入密码"
                />
                </ClearableField>
                <span id="account-confirm-password-help" className={`mt-2 block text-xs leading-5 ${confirmPinTouched && !confirmPinIsValid ? "text-[#a1473b]" : "text-[#738078]"}`} aria-live="polite">{confirmPinTouched && !confirmPinIsValid ? (confirmPin !== pin ? "两次输入的密码不一致。" : accountPasswordRequirement()) : "请再次输入同一密码。"}</span>
              </label>}
              {syncingLogin && <p className="mt-4 rounded-xl bg-[#e3edf4] px-3 py-2 text-sm leading-6 text-[#405d70]" role="status">登录成功，正在同步当前账号的生词本、文章和缓存，请稍候…</p>}
              {message && <p className="mt-4 text-sm leading-6 text-[#8a3d34]" role="alert">{message}</p>}
              <button className="mt-6 w-full rounded-full bg-[#174f82] px-5 py-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2868ad] disabled:cursor-not-allowed disabled:opacity-50" disabled={!account.configured || submitting || phone.trim().length < 11 || !pinIsValid || (loginMode === "register" && (!nickname.trim() || !confirmPinIsValid))} type="submit">{syncingLogin ? "正在同步账号数据…" : submitting ? (loginMode === "login" ? "正在登录…" : "正在创建账号…") : loginMode === "login" ? "登录并同步" : "创建账号并登录"}</button>
            </form>
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
  const { account, isOffline, localAccount, loading, openLogin, logout } = useAccount();
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
  if (isOffline) {
    return (
      <span className="cr-nav-primary" title="当前离线，只能使用此设备上的账号内容">
        {localAccount?.nickname || (localAccount ? "上次登录账号" : "未确认账号")} · 离线
      </span>
    );
  }
  if (!account.authenticated) return <button className="cr-nav-primary" type="button" onClick={() => openLogin("登录后可跨设备同步生词本、文章和翻译缓存。")}>登录</button>;
  const label = account.profile?.nickname || account.profile?.email.split("@")[0] || "账号";
  return (
    <span className="relative">
      <button className="cr-nav-primary" type="button" onClick={() => { setOpen((value) => !value); setLogoutError(""); }} aria-expanded={open}>{label}</button>
      {open && <span className="absolute right-0 top-[calc(100%+10px)] z-50 grid w-60 gap-1 rounded-2xl border border-black/10 bg-[#fbfcfe] p-2 text-left text-sm shadow-xl">
        <span className="px-3 py-2 text-xs text-[#6c786f]">{account.plan?.displayName || "当前套餐"}</span>
        {account.plan?.id === "admin" && <Link className="rounded-xl px-3 py-2 font-medium text-[#174d73] hover:bg-[#edf5fb]" href="/admin">打开管理后台</Link>}
        <Link className="rounded-xl px-3 py-2 hover:bg-black/5" href="/account/usage">用量与套餐</Link>
        {account.localOnly || account.localDirect ? (
          <span className="rounded-xl px-3 py-2 text-xs leading-5 text-[#6c786f]">{account.localDirect ? "localhost 已固定连接到这个云端开发者账号；数据会正常同步。" : "本机学习身份固定启用；文章和生词本保存在此浏览器。"}</span>
        ) : (
          <button className="rounded-xl px-3 py-2 text-left hover:bg-black/5 disabled:cursor-wait disabled:text-black/45" type="button" disabled={loggingOut} onClick={() => void handleLogout()}>{loggingOut ? "正在同步并退出…" : "退出登录"}</button>
        )}
        {logoutError && <span className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" role="alert">{logoutError}</span>}
      </span>}
    </span>
  );
}
