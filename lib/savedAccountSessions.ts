import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Session, User } from "@supabase/supabase-js";
import { USER_SESSION_MAX_AGE_SECONDS } from "./sessionPolicy";

export const MAX_SAVED_ACCOUNTS = 3;
export interface SavedAccount { userId: string; nickname: string; phone: string }
interface SavedSession extends SavedAccount { refreshToken: string; accessToken?: string; expiresAt: number }
const ROSTER_COOKIE = "context_reader_account_ids";
const sessionCookie = (userId: string) => `context_reader_saved_${userId}`;
function roster(value: string): string[] {
  return [...new Set(value.split(",").filter(id => /^[a-zA-Z0-9-]{1,80}$/.test(id)))].slice(0, MAX_SAVED_ACCOUNTS);
}
const options = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });
function key() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("账号服务暂不可用。");
  return createHash("sha256").update(`context-reader:saved-session:v1:${secret}`).digest();
}
export function encodeSavedSession(value: SavedSession): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function decodeSavedSession(value: string): SavedSession | null {
  try {
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const saved = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()) as SavedSession;
    return saved.userId && saved.refreshToken && saved.expiresAt > Date.now() ? saved : null;
  } catch { return null; }
}
export async function savedSessionSlots() {
  const store = await cookies();
  return roster(store.get(ROSTER_COOKIE)?.value ?? "").map(userId => {
    const name = sessionCookie(userId);
    const saved = decodeSavedSession(store.get(name)?.value ?? "");
    return { name, session: saved?.userId === userId ? saved : null };
  });
}
export async function listSavedAccounts(): Promise<SavedAccount[]> {
  return (await savedSessionSlots()).flatMap(({ session }) => session ? [{ userId: session.userId, nickname: session.nickname, phone: session.phone }] : []);
}
export async function rememberSavedSession(user: User, refreshToken: string, accessToken?: string): Promise<void> {
  if (!refreshToken) return;
  const slots = await savedSessionSlots();
  const existing = slots.find(s => s.session?.userId === user.id);
  const activeIds = slots.flatMap(s => s.session ? [s.session.userId] : []);
  if (!existing && activeIds.length >= MAX_SAVED_ACCOUNTS) throw new Error("已登录三个账号，请先移除一个账号再添加。");
  const slot = existing ?? { name: sessionCookie(user.id), session: null };
  // Only enrollment changes the roster. A delayed refresh writes its own UUID
  // cookie, so it cannot replace an account subsequently occupying a freed slot.
  if (!existing) (await cookies()).set(ROSTER_COOKIE, [...activeIds, user.id].join(","), { ...options(), maxAge: 365 * 24 * 60 * 60 });
  const nickname = String(user.user_metadata?.nickname || "账号").slice(0, 40);
  const phone = String(user.user_metadata?.phone || "").slice(0, 20);
  if (slot.session?.refreshToken === refreshToken && slot.session.nickname === nickname && slot.session.phone === phone && (!accessToken || slot.session.accessToken === accessToken)) return;
  const session: SavedSession = {
    userId: user.id, refreshToken, accessToken: accessToken || slot.session?.accessToken, nickname,
    phone,
    expiresAt: Date.now() + USER_SESSION_MAX_AGE_SECONDS * 1000,
  };
  (await cookies()).set(slot.name, encodeSavedSession(session), { ...options(), maxAge: USER_SESSION_MAX_AGE_SECONDS });
}
export async function forgetSavedAccount(userId: string): Promise<void> {
  const store = await cookies();
  const ids = roster(store.get(ROSTER_COOKIE)?.value ?? "");
  if (!ids.includes(userId)) return;
  store.set(sessionCookie(userId), "", { ...options(), maxAge: 0 });
  store.set(ROSTER_COOKIE, ids.filter(id => id !== userId).join(","), { ...options(), maxAge: 365 * 24 * 60 * 60 });
}
export async function forgetSavedRefreshToken(refreshToken: string): Promise<void> {
  for (const { session } of await savedSessionSlots()) if (session?.refreshToken === refreshToken) await forgetSavedAccount(session.userId);
}
export async function rememberSession(session: Session) { await rememberSavedSession(session.user, session.refresh_token, session.access_token); }
