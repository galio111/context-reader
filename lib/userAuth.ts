import { createClient, type Session, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const ACCESS_COOKIE = "context_reader_access";
const REFRESH_COOKIE = "context_reader_refresh";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function authConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function authClient() {
  const config = authConfig();
  if (!config) {
    throw new Error("Account service is not configured.");
  }
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function isAccountSystemConfigured(): boolean {
  return Boolean(authConfig());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, 254);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export async function requestEmailOtp(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("请输入有效的邮箱地址。");
  }

  const { error } = await authClient().auth.signInWithOtp({
    email: normalized,
    options: {
      shouldCreateUser: true,
    },
  });
  if (error) {
    throw new Error(error.message || "验证码发送失败，请稍后重试。");
  }
}

export async function verifyEmailOtp(email: string, token: string): Promise<Session> {
  const normalized = normalizeEmail(email);
  const normalizedToken = token.replace(/\s+/g, "").slice(0, 12);
  if (!isValidEmail(normalized) || !/^\d{6,12}$/.test(normalizedToken)) {
    throw new Error("邮箱或验证码格式不正确。");
  }

  const { data, error } = await authClient().auth.verifyOtp({
    email: normalized,
    token: normalizedToken,
    type: "email",
  });
  if (error || !data.session) {
    throw new Error(error?.message || "验证码无效或已过期。");
  }
  return data.session;
}

async function writeSessionCookies(session: Session): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
  };
  cookieStore.set(ACCESS_COOKIE, session.access_token, {
    ...base,
    maxAge: Math.max(60, session.expires_in || 3600),
  });
  cookieStore.set(REFRESH_COOKIE, session.refresh_token, {
    ...base,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function establishUserSession(session: Session): Promise<void> {
  await writeSessionCookies(session);
}

export async function clearUserSession(): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const options = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 0 };
  cookieStore.set(ACCESS_COOKIE, "", options);
  cookieStore.set(REFRESH_COOKIE, "", options);
}

async function readTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  const cookieStore = await cookies();
  return {
    accessToken: cookieStore.get(ACCESS_COOKIE)?.value ?? "",
    refreshToken: cookieStore.get(REFRESH_COOKIE)?.value ?? "",
  };
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const { accessToken, refreshToken } = await readTokens();
  const client = authClient();

  if (accessToken) {
    const { data } = await client.auth.getUser(accessToken);
    if (data.user) {
      return data.user;
    }
  }

  if (!refreshToken) {
    return null;
  }

  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    await clearUserSession();
    return null;
  }

  await writeSessionCookies(data.session);
  return data.user;
}

export async function signOutAuthenticatedUser(): Promise<void> {
  const { accessToken } = await readTokens();
  if (accessToken && isAccountSystemConfigured()) {
    await authClient().auth.admin.signOut(accessToken, "global").catch(() => undefined);
  }
  await clearUserSession();
}
