"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_DATA_CHANGED_EVENT } from "@/lib/accountEvents";
import { describeApiFailure, describeCaughtRequestError } from "@/lib/clientErrorReporting";
import { clearLocalAccountData, prepareLocalAccountForUser, syncAccountData } from "@/lib/accountSyncClient";
import {
  clearLocalAccountSession,
  readLocalAccountSession,
  rememberLocalAccountSession,
  type LocalAccountSession,
} from "@/lib/localAccountSession";
import type { AccountSessionState } from "@/types/account";

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
  refreshAccount: () => Promise<void>;
  logout: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

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
  const [isOffline, setIsOffline] = useState(false);
  const [localAccount, setLocalAccount] = useState<LocalAccountSession | null>(null);
  const [offlineActionNotice, setOfflineActionNotice] = useState("");
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
  const syncing = useRef(false);

  const refreshAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { account?: AccountSessionState; unavailable?: boolean } | null;
      if (!response.ok || data?.unavailable) {
        throw new Error("account service unavailable");
      }
      const nextAccount = data?.account ?? emptyAccount;
      setAccount(nextAccount);
      setIsOffline(false);
      setOfflineActionNotice("");
      if (nextAccount.authenticated) {
        const snapshot = rememberLocalAccountSession(nextAccount);
        setLocalAccount(snapshot);
        const low = nextAccount.usage.find((item) => item.allowance > 0 && item.remaining / item.allowance <= 0.2);
        setUsageNotice(low ? (low.remaining === 0 ? "本周期额度已用完，可前往用量页查看。" : `额度剩余 ${low.remaining} / ${low.allowance}，已低于 20%。`) : "");
      } else {
        clearLocalAccountSession();
        setLocalAccount(null);
        setUsageNotice("");
      }
    } catch {
      setIsOffline(true);
      setAccount(emptyAccount);
      setLocalAccount(readLocalAccountSession());
      setUsageNotice("");
    } finally {
      setLoading(false);
    }
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
      setAccount(emptyAccount);
      setLocalAccount(readLocalAccountSession());
      setUsageNotice("");
      setLoading(false);
    };
    const retryOnline = () => {
      setLoading(true);
      void refreshAccount();
    };

    if (!navigator.onLine) markOffline();
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", retryOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", retryOnline);
    };
  }, [refreshAccount]);

  const syncNow = useCallback(async () => {
    if (!account.authenticated || syncing.current) return;
    syncing.current = true;
    try {
      if (account.profile?.userId) prepareLocalAccountForUser(account.profile.userId);
      await syncAccountData();
      await refreshAccount();
    } finally {
      syncing.current = false;
    }
  }, [account.authenticated, account.profile?.userId, refreshAccount]);

  useEffect(() => {
    if (!account.authenticated) return;
    if (
      (window.location.pathname.startsWith("/admin") && account.plan?.id !== "admin") ||
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
  }, [account.authenticated, account.plan?.id, syncNow]);

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
    if (!/^\d{6}$/.test(pin)) {
      setMessage("密码必须是完整的 6 位数字。");
      return;
    }
    if (loginMode === "register" && !/^\d{6}$/.test(confirmPin)) {
      setConfirmPinTouched(true);
      setMessage("确认密码也必须是完整的 6 位数字。");
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
    window.location.href = "/home-v2";
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    account, loading, isOffline, hasLocalAccountAccess, localAccount, loginOpen, openLogin, closeLogin,
    requireAccount, requireLocalAccount, refreshAccount, logout, syncNow,
  }), [
    account, loading, isOffline, hasLocalAccountAccess, localAccount, loginOpen, openLogin, closeLogin,
    requireAccount, requireLocalAccount, refreshAccount, logout, syncNow,
  ]);

  const pinIsValid = /^\d{6}$/.test(pin);
  const pinFeedback = !pinTouched
    ? "请输入完整的 6 位数字；不足 6 位时不能登录。"
    : pinIsValid
      ? "已输入 6 位数字。"
      : pin.length === 0
        ? "请输入 6 位数字密码。"
        : `还需输入 ${6 - pin.length} 位数字。`;
  const confirmPinIsValid = /^\d{6}$/.test(confirmPin) && confirmPin === pin;

  return (
    <AccountContext.Provider value={value}>
      {children}
      {isOffline && (
        <aside
          className="fixed left-1/2 top-3 z-[190] w-[min(94vw,760px)] -translate-x-1/2 rounded-xl bg-[#fff7df] px-4 py-3 text-[#533d17] shadow-[0_4px_8px_rgba(69,48,12,.16)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                离线模式
                {localAccount?.nickname ? ` · ${localAccount.nickname}` : ""}
              </p>
              <p className="mt-1 text-sm leading-6">
                {localAccount
                  ? "可阅读和保存本机文章、查看或记录生词、使用已有解释与翻译缓存。"
                  : "可继续阅读当前页面；此设备没有可确认的历史账号，因此账号内容暂不显示。"}
                {" "}新查词、AI 翻译、URL 导入、OCR、云同步和用量查询需要联网。
              </p>
              {offlineActionNotice && <p className="mt-1 text-sm font-medium" role="alert">{offlineActionNotice}</p>}
            </div>
            <button
              className="shrink-0 rounded-full bg-[#684c17] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#543c12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#684c17]"
              type="button"
              onClick={() => {
                setLoading(true);
                void refreshAccount();
              }}
            >
              重新检测网络
            </button>
          </div>
        </aside>
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
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">昵称<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="text" autoComplete="nickname" maxLength={40} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例如：小林" /></label>}
              <label className="mt-5 block text-sm font-medium">手机号<input className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+\s()-]/g, "").slice(0, 24))} placeholder="中国大陆手机号" /></label>
              <label className="mt-5 block text-sm font-medium">6 位数字密码
                <span className="relative mt-2 block">
                  <input
                    className={`w-full rounded-xl border bg-white px-4 py-3 pr-16 text-lg tracking-[.22em] outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15 ${pinTouched && !pinIsValid ? "border-[#b85a4c]" : "border-black/15"}`}
                    type={showPin ? "text" : "password"}
                    name={`context-reader-${loginMode}-credential`}
                    inputMode="numeric"
                    autoComplete="off"
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
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                    }}
                    placeholder="请输入 6 位数字"
                  />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1.5 text-xs text-[#526158] hover:bg-black/5" type="button" onClick={() => { if (!passwordInputReady) { setPin(""); setPasswordInputReady(true); } setShowPin((value) => !value); }} aria-label={showPin ? "隐藏密码" : "显示密码"}>{showPin ? "隐藏" : "显示"}</button>
                </span>
              </label>
              <p id="account-password-help" className={`mt-2 text-xs leading-5 ${pinTouched && !pinIsValid ? "text-[#a1473b]" : pinIsValid ? "text-[#52705d]" : "text-[#738078]"}`} aria-live="polite">{pinFeedback}</p>
              {loginMode === "register" && <label className="mt-5 block text-sm font-medium">确认密码
                <input
                  className={`mt-2 w-full rounded-xl border bg-white px-4 py-3 text-lg tracking-[.22em] outline-none focus:border-[#2868ad] focus:ring-2 focus:ring-[#2868ad]/15 ${confirmPinTouched && !confirmPinIsValid ? "border-[#b85a4c]" : "border-black/15"}`}
                  type={showPin ? "text" : "password"}
                  name="context-reader-confirm-credential"
                  inputMode="numeric"
                  autoComplete="off"
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
                    setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  placeholder="再次输入 6 位数字"
                />
                <span id="account-confirm-password-help" className={`mt-2 block text-xs leading-5 ${confirmPinTouched && !confirmPinIsValid ? "text-[#a1473b]" : "text-[#738078]"}`} aria-live="polite">{confirmPinTouched && !confirmPinIsValid ? (confirmPin.length < 6 ? `确认密码还需输入 ${6 - confirmPin.length} 位数字。` : "两次输入的密码不一致。") : "请再次输入同一组 6 位数字。"}</span>
              </label>}
              {syncingLogin && <p className="mt-4 rounded-xl bg-[#e3edf4] px-3 py-2 text-sm leading-6 text-[#405d70]" role="status">登录成功，正在同步当前账号的生词本、文章和缓存，请稍候…</p>}
              {message && <p className="mt-4 text-sm leading-6 text-[#8a3d34]" role="alert">{message}</p>}
              <button className="mt-6 w-full rounded-full bg-[#174f82] px-5 py-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2868ad] disabled:cursor-not-allowed disabled:opacity-50" disabled={!account.configured || submitting || phone.trim().length < 11 || !pinIsValid || (loginMode === "register" && (!nickname.trim() || !confirmPinIsValid))} type="submit">{syncingLogin ? "正在同步账号数据…" : submitting ? (loginMode === "login" ? "正在登录…" : "正在创建账号…") : loginMode === "login" ? "登录并同步" : "创建账号并登录"}</button>
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
        <button className="rounded-xl px-3 py-2 text-left hover:bg-black/5 disabled:cursor-wait disabled:text-black/45" type="button" disabled={loggingOut} onClick={() => void handleLogout()}>{loggingOut ? "正在同步并退出…" : "退出登录"}</button>
        {logoutError && <span className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" role="alert">{logoutError}</span>}
      </span>}
    </span>
  );
}
