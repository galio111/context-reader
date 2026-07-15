import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-context_reader_admin"
  : "context_reader_admin";
const COOKIE_MAX_AGE = 60 * 60 * 8;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || "";
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
  if (!expected || !password || password.length > 256) {
    return false;
  }
  return safeEqual(password, expected);
}

export async function createAdminSession(): Promise<void> {
  if (sessionSecret().length < 32) {
    throw new Error("Admin session secret is not configured securely.");
  }
  const issuedAt = Date.now().toString();
  const nonce = randomBytes(16).toString("base64url");
  const version = process.env.ADMIN_SESSION_VERSION || "1";
  const payload = `${issuedAt}.${nonce}.${version}`;
  const value = `${payload}.${sign(payload)}`;
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

export async function isAdminRequest(): Promise<boolean> {
  if (sessionSecret().length < 32) {
    return false;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!raw) {
    return false;
  }

  const [issuedAt, nonce, version, signature] = raw.split(".");
  if (!issuedAt || !nonce || !version || !signature || version !== (process.env.ADMIN_SESSION_VERSION || "1")) {
    return false;
  }

  const timestamp = Number(issuedAt);
  const age = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || age < -MAX_CLOCK_SKEW_MS || age > COOKIE_MAX_AGE * 1000) {
    return false;
  }

  return safeEqual(signature, sign(`${issuedAt}.${nonce}.${version}`));
}
