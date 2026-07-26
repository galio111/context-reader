"use client";

import type { AccountSessionState } from "@/types/account";

const LOCAL_ACCOUNT_SESSION_KEY = "context-reader:last-account-session:v1";

export interface LocalAccountSession {
  userId: string;
  nickname: string;
  lastVerifiedAt: string;
}

export function readLocalAccountSession(): LocalAccountSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(LOCAL_ACCOUNT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalAccountSession>;
    if (!parsed.userId || !parsed.lastVerifiedAt) return null;
    return {
      userId: parsed.userId,
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
      lastVerifiedAt: parsed.lastVerifiedAt,
    };
  } catch {
    return null;
  }
}

export function rememberLocalAccountSession(account: AccountSessionState): LocalAccountSession | null {
  if (typeof window === "undefined" || !account.authenticated || !account.profile?.userId) return null;

  const snapshot: LocalAccountSession = {
    userId: account.profile.userId,
    nickname: account.profile.nickname.trim(),
    lastVerifiedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(LOCAL_ACCOUNT_SESSION_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function clearLocalAccountSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_ACCOUNT_SESSION_KEY);
}
