import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { ipAddress } from "@vercel/functions/headers";
import { cookies } from "next/headers";
import { accountFetch, getUserPlanId } from "@/lib/accountStore";
import { isLocalOnlyDeveloperUser } from "@/lib/localDeveloper";
import { getAuthenticatedUser, isAccountSystemConfigured } from "@/lib/userAuth";
import type { AccountPlanId } from "@/types/account";

const GUEST_COOKIE = "context_reader_guest";
const GUEST_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface UsageIdentity {
  ownerKey: string;
  planId: AccountPlanId;
  userId?: string;
  guestId?: string;
  authenticated: boolean;
  suspended: boolean;
  localOnly?: boolean;
}

function cookieSecret(): string {
  return (
    process.env.ACCOUNT_COOKIE_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function signature(value: string): string {
  return createHmac("sha256", cookieSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseGuestCookie(value: string): string | null {
  const [id, signed] = value.split(".", 2);
  if (!id || !signed || !/^[0-9a-f-]{36}$/i.test(id) || !cookieSecret()) {
    return null;
  }
  return safeEqual(signature(id), signed) ? id : null;
}

async function guestIdFromCookie(): Promise<string> {
  const cookieStore = await cookies();
  const existing = parseGuestCookie(cookieStore.get(GUEST_COOKIE)?.value ?? "");
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  cookieStore.set(GUEST_COOKIE, `${id}.${signature(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_MAX_AGE_SECONDS,
  });
  return id;
}

function requestIpHash(request: Request): string {
  const value = ipAddress(request)?.slice(0, 64) || "unknown";
  return createHash("sha256").update(`${cookieSecret()}:${value}`).digest("hex");
}

async function ensureGuest(id: string, ipHash: string): Promise<boolean> {
  await accountFetch("guest_identities?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{ id, last_ip_hash: ipHash }]),
  });
  await accountFetch(`guest_identities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_ip_hash: ipHash, last_seen_at: new Date().toISOString() }),
  });
  const rows = await accountFetch<Array<{ status: "active" | "suspended" }>>(
    `guest_identities?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
  );
  return rows[0]?.status === "suspended";
}

export async function resolveUsageIdentity(request: Request): Promise<UsageIdentity> {
  if (!isAccountSystemConfigured()) {
    throw new Error("Account service is not configured.");
  }

  const user = await getAuthenticatedUser();
  if (user) {
    if (isLocalOnlyDeveloperUser(user)) {
      return {
        ownerKey: `local:${user.id}`,
        userId: user.id,
        planId: "free",
        authenticated: true,
        suspended: false,
        localOnly: true,
      };
    }
    const [planId, profiles] = await Promise.all([
      getUserPlanId(user.id),
      accountFetch<Array<{ status: "active" | "suspended" | "deleted" }>>(
        `account_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=status&limit=1`,
      ),
    ]);
    return {
      ownerKey: `user:${user.id}`,
      userId: user.id,
      planId,
      authenticated: true,
      suspended: profiles[0]?.status !== "active",
    };
  }

  const guestId = await guestIdFromCookie();
  const suspended = await ensureGuest(guestId, requestIpHash(request));
  return {
    ownerKey: `guest:${guestId}`,
    guestId,
    planId: "guest",
    authenticated: false,
    suspended,
  };
}
