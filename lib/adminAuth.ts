import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "context_reader_admin";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected || !password) {
    return false;
  }
  return safeEqual(password, expected);
}

export async function createAdminSession(): Promise<void> {
  const issuedAt = Date.now().toString();
  const value = `${issuedAt}.${sign(issuedAt)}`;
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

export async function isAdminRequest(): Promise<boolean> {
  if (!sessionSecret()) {
    return false;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!raw) {
    return false;
  }

  const [issuedAt, signature] = raw.split(".");
  if (!issuedAt || !signature) {
    return false;
  }

  const timestamp = Number(issuedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > COOKIE_MAX_AGE * 1000) {
    return false;
  }

  return safeEqual(signature, sign(issuedAt));
}

