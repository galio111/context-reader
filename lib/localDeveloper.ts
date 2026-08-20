import "server-only";

import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import type { AccountSessionState } from "@/types/account";

const LOCAL_ONLY_DEVELOPER_ID = "7952603c-2c59-4e78-927b-6ba433dc0eb6";

function hasUsableSupabaseConfig(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || serviceKey.length < 32) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function configuredCloudDeveloperId(): string {
  const value = process.env.LOCAL_DEVELOPER_USER_ID?.trim() || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
}

function isCloudBackedLocalDeveloperEnvironment(): boolean {
  return process.env.NODE_ENV === "development"
    && hasUsableSupabaseConfig()
    && Boolean(configuredCloudDeveloperId());
}

/**
 * Deliberately unavailable from `next build` / `next start` and restricted to
 * loopback requests. An explicit UUID represents a real cloud account; without
 * usable Supabase configuration this falls back to a browser-local identity.
 */
export function isLocalDeveloperEnvironment(): boolean {
  return process.env.NODE_ENV === "development"
    && (isCloudBackedLocalDeveloperEnvironment() || !hasUsableSupabaseConfig());
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return /^localhost(?::\d+)?$/.test(normalized)
    || /^127\.0\.0\.1(?::\d+)?$/.test(normalized)
    || /^\[::1\](?::\d+)?$/.test(normalized);
}

function localDeveloperNickname(): string {
  return process.env.LOCAL_DEVELOPER_NICKNAME?.trim() || "本机学习模式";
}

function localDeveloperUser(): User {
  const cloudUserId = isCloudBackedLocalDeveloperEnvironment() ? configuredCloudDeveloperId() : "";
  const phone = cloudUserId ? (process.env.LOCAL_DEVELOPER_PHONE?.trim() || "") : "";
  return {
    id: cloudUserId || LOCAL_ONLY_DEVELOPER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: cloudUserId && phone ? `p${phone}@phone.context-reader.invalid` : "",
    phone: "",
    app_metadata: { provider: "local-development", providers: ["local-development"] },
    user_metadata: {
      nickname: localDeveloperNickname(),
      phone,
      login_method: "phone_pin",
      phone_verified: false,
      local_developer: true,
      cloud_backed: Boolean(cloudUserId),
    },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  } as User;
}

export async function getLocalDeveloperUser(): Promise<User | null> {
  if (!isLocalDeveloperEnvironment()) return null;

  try {
    const host = (await headers()).get("host") ?? "";
    return isLoopbackHost(host) ? localDeveloperUser() : null;
  } catch {
    return null;
  }
}

export function isLocalDeveloperUser(user: Pick<User, "id"> | null | undefined): boolean {
  if (!user || !isLocalDeveloperEnvironment()) return false;
  return user.id === LOCAL_ONLY_DEVELOPER_ID
    || (isCloudBackedLocalDeveloperEnvironment() && user.id === configuredCloudDeveloperId());
}

export function isLocalOnlyDeveloperUser(user: Pick<User, "id"> | null | undefined): boolean {
  return Boolean(user && isLocalDeveloperEnvironment() && user.id === LOCAL_ONLY_DEVELOPER_ID);
}

export function isCloudBackedLocalDeveloperUser(user: Pick<User, "id"> | null | undefined): boolean {
  return Boolean(
    user
    && isCloudBackedLocalDeveloperEnvironment()
    && user.id === configuredCloudDeveloperId(),
  );
}

export function getLocalDeveloperAccountState(): AccountSessionState {
  return {
    configured: true,
    authenticated: true,
    localOnly: true,
    profile: {
      userId: LOCAL_ONLY_DEVELOPER_ID,
      email: "",
      phone: "",
      loginMethod: "phone_pin",
      phoneVerified: false,
      nickname: localDeveloperNickname(),
      avatarUrl: "",
      englishLevel: "",
      learningGoal: "",
      status: "active",
    },
    plan: {
      id: "free",
      displayName: "本机学习模式",
      priceCny: 0,
      active: true,
      limits: [],
    },
    usage: [],
  };
}
