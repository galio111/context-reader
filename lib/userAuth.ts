import { createClient, type Session, type User } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { getLocalDeveloperUser, isLocalDeveloperEnvironment } from "@/lib/localDeveloper";

const ACCESS_COOKIE = "context_reader_access";
const REFRESH_COOKIE = "context_reader_refresh";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const PHONE_ACCOUNT_DOMAIN = "phone.context-reader.invalid";

function authConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 32) return null;
  try {
    const parsed = new URL(url);
    const isPrivateDockerEndpoint =
      parsed.protocol === "http:" &&
      ["supabase-api", "localhost", "127.0.0.1"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !isPrivateDockerEndpoint) || !parsed.hostname) return null;
    return { url: url.replace(/\/$/, ""), key };
  } catch {
    return null;
  }
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
  return Boolean(authConfig()) || isLocalDeveloperEnvironment();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, 254);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function normalizeMainlandPhone(value: string): string {
  let normalized = value.trim().replace(/[\s()-]/g, "");
  if (normalized.startsWith("+86")) normalized = normalized.slice(3);
  else if (normalized.startsWith("0086")) normalized = normalized.slice(4);
  return normalized.slice(0, 20);
}

export function isValidMainlandPhone(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(normalizeMainlandPhone(value));
}

export function normalizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function isValidPin(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}

export function phoneAccountEmail(phone: string): string {
  return `p${normalizeMainlandPhone(phone)}@${PHONE_ACCOUNT_DOMAIN}`;
}

export function phoneFromAccountEmail(email: string): string {
  const match = email.trim().toLowerCase().match(new RegExp(`^p(1[3-9]\\d{9})@${PHONE_ACCOUNT_DOMAIN.replace(/\./g, "\\.")}$`));
  return match?.[1] ?? "";
}

export function phoneFromUser(user: Pick<User, "email" | "user_metadata">): string {
  const metadataPhone = normalizeMainlandPhone(String(user.user_metadata?.phone ?? ""));
  return isValidMainlandPhone(metadataPhone) ? metadataPhone : phoneFromAccountEmail(user.email ?? "");
}

export async function registerPhonePinAccount(phone: string, nickname: string, pin: string): Promise<Session> {
  const normalizedPhone = normalizeMainlandPhone(phone);
  const normalizedNickname = normalizeNickname(nickname);
  const normalizedPin = pin.trim();
  if (!isValidMainlandPhone(normalizedPhone)) {
    throw new Error("请输入有效的中国大陆手机号。");
  }
  if (normalizedNickname.length < 1) {
    throw new Error("请输入昵称，方便你和管理员识别账号。");
  }
  if (!isValidPin(normalizedPin)) {
    throw new Error("密码必须是 6 位数字。");
  }

  const client = authClient();
  const email = phoneAccountEmail(normalizedPhone);
  const { error: createError } = await client.auth.admin.createUser({
    email,
    password: normalizedPin,
    email_confirm: true,
    user_metadata: {
      nickname: normalizedNickname,
      phone: normalizedPhone,
      login_method: "phone_pin",
      phone_verified: false,
    },
  });
  if (createError) {
    if (/already|registered|exists|unique/i.test(createError.message)) {
      throw new Error("该手机号已注册，请直接登录。");
    }
    throw new Error("注册失败，请稍后重试。");
  }

  return loginPhonePinAccount(normalizedPhone, normalizedPin);
}

export async function loginPhonePinAccount(phone: string, pin: string): Promise<Session> {
  const normalizedPhone = normalizeMainlandPhone(phone);
  const normalizedPin = pin.trim();
  if (!isValidMainlandPhone(normalizedPhone) || !isValidPin(normalizedPin)) {
    throw new Error("手机号或密码不正确。");
  }

  const { data, error } = await authClient().auth.signInWithPassword({
    email: phoneAccountEmail(normalizedPhone),
    password: normalizedPin,
  });
  if (error || !data.session || !data.user) {
    throw new Error("手机号或密码不正确。");
  }
  return data.session;
}

export async function resetPhoneAccountPin(userId: string): Promise<string> {
  const client = authClient();
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error("未找到这个账号。");
  }
  if (!phoneFromUser(data.user)) {
    throw new Error("这个账号不是手机号密码账号。");
  }
  const temporaryPin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error: updateError } = await client.auth.admin.updateUserById(userId, { password: temporaryPin });
  if (updateError) {
    throw new Error(updateError.message || "密码重置失败。");
  }
  return temporaryPin;
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

export async function adoptSupabaseSession(accessToken: string, refreshToken: string): Promise<Session> {
  const normalizedAccessToken = accessToken.trim();
  const normalizedRefreshToken = refreshToken.trim();
  if (!normalizedAccessToken || !normalizedRefreshToken || normalizedAccessToken.length > 8_192 || normalizedRefreshToken.length > 8_192) {
    throw new Error("登录链接无效或不完整。");
  }

  const { data, error } = await authClient().auth.setSession({
    access_token: normalizedAccessToken,
    refresh_token: normalizedRefreshToken,
  });
  if (error || !data.session || !data.user) {
    throw new Error(error?.message || "登录链接无效或已过期。");
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
  const localDeveloper = await getLocalDeveloperUser();
  if (localDeveloper) return localDeveloper;

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
