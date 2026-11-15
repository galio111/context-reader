import { NextResponse } from "next/server";
import extensionIdentity from "@/chrome-extension/identity.json";
import { ipAddress } from "@vercel/functions/headers";
import { staticAssetParts } from "./staticEncoding";
import { MAX_DOCUMENT_BYTES } from "./documentSource";

interface RateWindow {
  count: number;
  resetAt: number;
}

interface RateRule {
  bucket: string;
  limit: number;
  windowMs: number;
}

interface RateStore {
  windows: Map<string, RateWindow>;
  lastCleanupAt: number;
}

const globalRateStore = globalThis as typeof globalThis & {
  __contextReaderRateStore?: RateStore;
};

const store = globalRateStore.__contextReaderRateStore ?? {
  windows: new Map<string, RateWindow>(),
  lastCleanupAt: 0,
};

globalRateStore.__contextReaderRateStore = store;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Personal reading is controlled by route-level identity, durable usage/billing
// and bounded AI concurrency, not by counts of HTTP requests from one IP. One
// lookup starts both stream and JSON work; translations and cache/session reads
// add more traffic without representing additional user questions. Do not let
// either those requests or unrelated API traffic exhaust a reading time window.
// Keep this an exact method/path allowlist, never a cookie-based auth bypass.
const READING_POST_ROUTES = new Set([
  "/api/explain-word", "/api/explain-word-stream", "/api/dictionary", "/api/dictionary-stream",
  "/api/ask-sentence", "/api/summarize-article", "/api/pronunciation", "/api/usage/cache-lookup",
  "/api/translate-article", "/api/translate-article/start", "/api/translate-article/finish",
  ...["explain", "stream", "dictionary", "ask", "translate", "pronunciation"].map(operation => `/api/extension/execute/${operation}`),
]);
const READING_GET_ROUTES = new Set(["/api/auth/session", "/api/dictionary-history"]);

const COSTLY_ROUTE_RULES: Array<[RegExp, RateRule[]]> = [
  [/^\/api\/documents$/, [{ bucket: "document-import", limit: 10, windowMs: 10 * MINUTE }]],
  [/^\/api\/study\/profile$/, [{ bucket: "study-profile", limit: 4, windowMs: MINUTE }]],
  [/^\/api\/study\/reading$/, [{ bucket: "study-reading", limit: 20, windowMs: MINUTE }]],
  [/^\/api\/billing$/, [{ bucket: "billing", limit: 30, windowMs: MINUTE }]],
  [/^\/api\/admin\/login$/, [{ bucket: "admin-login", limit: 5, windowMs: 15 * MINUTE }]],
  [/^\/api\/auth\/request-otp$/, [{ bucket: "auth-otp", limit: 5, windowMs: 15 * MINUTE }]],
  [/^\/api\/auth\/verify-otp$/, [{ bucket: "auth-verify", limit: 10, windowMs: 15 * MINUTE }]],
  [/^\/api\/auth\/phone-register$/, [{ bucket: "auth-phone-register", limit: 3, windowMs: 15 * MINUTE }]],
  [/^\/api\/auth\/phone-login$/, [{ bucket: "auth-phone-login", limit: 5, windowMs: 15 * MINUTE }]],
  [/^\/api\/account\/invitation-code$/, [{ bucket: "invitation-redeem", limit: 10, windowMs: 15 * MINUTE }]],
  [/^\/api\/ocr-image(?:-layout|-url)?$/, [{ bucket: "ocr", limit: 4, windowMs: MINUTE }]],
  [/^\/api\/(?:import-url|download-image|article-images\/localize)$/, [{ bucket: "remote-fetch", limit: 15, windowMs: MINUTE }]],
];

const DAILY_LIMITED_ROUTE = /^\/api\/ocr-image(?:-layout|-url)?$/;

function clientAddress(request: Request): string {
  return ipAddress(request)?.slice(0, 64) || "unknown";
}

function cleanupExpiredWindows(now: number): void {
  if (now - store.lastCleanupAt < MINUTE) {
    return;
  }
  store.lastCleanupAt = now;
  for (const [key, value] of store.windows) {
    if (value.resetAt <= now) {
      store.windows.delete(key);
    }
  }
}

function consume(key: string, rule: RateRule, now: number): { allowed: boolean; remaining: number; resetAt: number } {
  const storeKey = `${rule.bucket}:${key}`;
  const existing = store.windows.get(storeKey);
  const current = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + rule.windowMs }
    : existing;

  current.count += 1;
  store.windows.set(storeKey, current);
  return {
    allowed: current.count <= rule.limit,
    remaining: Math.max(0, rule.limit - current.count),
    resetAt: current.resetAt,
  };
}

function routeRules(pathname: string, method: string): RateRule[] {
  if ((method === "POST" && READING_POST_ROUTES.has(pathname))
    || (method === "GET" && READING_GET_ROUTES.has(pathname))) return [];
  // Cold page loads fetch many immutable build files. Keep their bounded read
  // budget independent of API work, using the same decoded-path guard as the
  // serving route. Encoded separators, traversal and unsupported methods must
  // not gain this allowance.
  if ((method === "GET" || method === "HEAD") && pathname.startsWith("/api/static-asset/")) {
    try {
      const parts = pathname.slice("/api/static-asset/".length).split("/").map(part => decodeURIComponent(part));
      if (staticAssetParts(parts)) return [{ bucket: "static-read", limit: 600, windowMs: MINUTE }];
    } catch {
      // Invalid percent encodings retain the ordinary API budget.
    }
  }
  // A bounded sync bootstrap can span many pages. It must not exhaust the
  // separate login, lookup or connectivity budget for the same connection.
  if (pathname === "/api/account/sync") return [{ bucket: "account-sync", limit: 120, windowMs: MINUTE }];
  // Study reconciliation is background data work, not another reading action.
  // A stale client must not spend the ordinary API budget for the same IP.
  if (pathname === "/api/study" && (method === "GET" || method === "POST")) {
    return [{ bucket: "study-sync", limit: 120, windowMs: MINUTE }];
  }
  const rules: RateRule[] = [{ bucket: "api-all", limit: 120, windowMs: MINUTE }];
  for (const [pattern, matchingRules] of COSTLY_ROUTE_RULES) {
    if (pattern.test(pathname)) {
      if (matchingRules[0]?.bucket === "admin-login" && method !== "POST") {
        break;
      }
      rules.push(...matchingRules);
      break;
    }
  }
  if (DAILY_LIMITED_ROUTE.test(pathname)) {
    rules.push({ bucket: "costly-daily", limit: 500, windowMs: DAY });
  }
  return rules;
}

function maxRequestBytes(pathname: string): number {
  if (pathname === "/api/documents") return MAX_DOCUMENT_BYTES + 16 * 1024;
  if (/^\/api\/ocr-image(?:-layout)?$/.test(pathname)) {
    return 9 * 1024 * 1024;
  }
  if (pathname === "/api/admin/public-articles" || pathname === "/api/admin/article-candidates") {
    return 8 * 1024 * 1024;
  }
  if (pathname === "/api/admin/article-covers") {
    return 5 * 1024 * 1024 + 256 * 1024;
  }
  if (pathname === "/api/admin/homepage-curation") return 1024 * 1024;
  if (pathname === "/api/account/sync") {
    return 8 * 1024 * 1024;
  }
  if (pathname === "/api/translate-article/start") return 512 * 1024;
  if (pathname === "/api/translate-article") {
    return 512 * 1024;
  }
  if (pathname === "/api/summarize-article") {
    return 128 * 1024;
  }
  return 64 * 1024;
}

function jsonError(
  message: string,
  status: number,
  headers: Record<string, string> = {},
  details: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { error: message, ...details },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function firstForwardedValue(value: string | null): string {
  return value?.split(",", 1)[0]?.trim() ?? "";
}

export function requestExternalOrigin(request: Request, fallbackUrl = new URL(request.url)): string {
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    || firstForwardedValue(request.headers.get("host"));
  if ((protocol !== "http" && protocol !== "https") || !host) {
    return fallbackUrl.origin;
  }
  try {
    const candidate = new URL(`${protocol}://${host}`);
    if (candidate.host !== host || candidate.username || candidate.password) {
      return fallbackUrl.origin;
    }
    return candidate.origin;
  } catch {
    return fallbackUrl.origin;
  }
}

export function protectApiRequest(request: Request): NextResponse | null {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const now = Date.now();
  cleanupExpiredWindows(now);

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes(pathname)) {
    return jsonError("请求内容过大。", 413);
  }

  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    const fetchSite = request.headers.get("sec-fetch-site");
    const extensionExecution = /^\/api\/extension\/execute\/[a-z]+$/.test(pathname)
      && request.headers.get("origin") === `chrome-extension://${extensionIdentity.id}`;
    if (fetchSite === "cross-site" && !extensionExecution) {
      return jsonError("不允许跨站请求。", 403);
    }

    if (pathname.startsWith("/api/admin/")) {
      const origin = request.headers.get("origin");
      if (!origin && process.env.NODE_ENV === "production") {
        return jsonError("管理操作缺少可信来源。", 403);
      }
      if (origin) {
        try {
          if (new URL(origin).origin !== requestExternalOrigin(request, url)) {
            return jsonError("管理操作必须来自本站。", 403);
          }
        } catch {
          return jsonError("请求来源无效。", 403);
        }
      }
    }
  }

  const ip = clientAddress(request);
  for (const rule of routeRules(pathname, request.method)) {
    const result = consume(ip, rule, now);
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
      return jsonError("请求过于频繁，请稍后再试。", 429, {
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": String(rule.limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      }, {
        code: "site_rate_limit",
        retryAfterSeconds: retryAfter,
      });
    }
  }

  return null;
}
