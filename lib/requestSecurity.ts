import { NextResponse } from "next/server";
import { ipAddress } from "@vercel/functions/headers";

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

const COSTLY_ROUTE_RULES: Array<[RegExp, RateRule[]]> = [
  [/^\/api\/admin\/login$/, [{ bucket: "admin-login", limit: 5, windowMs: 15 * MINUTE }]],
  [/^\/api\/explain-word(?:-stream)?$/, [{ bucket: "ai-explain", limit: 20, windowMs: MINUTE }]],
  [/^\/api\/ask-sentence$/, [{ bucket: "ai-question", limit: 10, windowMs: MINUTE }]],
  [/^\/api\/summarize-article$/, [{ bucket: "ai-summary", limit: 6, windowMs: MINUTE }]],
  [/^\/api\/translate-article$/, [{ bucket: "ai-translation", limit: 8, windowMs: MINUTE }]],
  [/^\/api\/ocr-image(?:-layout|-url)?$/, [{ bucket: "ocr", limit: 4, windowMs: MINUTE }]],
  [/^\/api\/(?:import-url|download-image)$/, [{ bucket: "remote-fetch", limit: 15, windowMs: MINUTE }]],
];

const COSTLY_ROUTE = /^\/api\/(?:explain-word(?:-stream)?|ask-sentence|summarize-article|translate-article|ocr-image(?:-layout|-url)?)$/;

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
  if (COSTLY_ROUTE.test(pathname)) {
    rules.push({ bucket: "costly-daily", limit: 500, windowMs: DAY });
  }
  return rules;
}

function maxRequestBytes(pathname: string): number {
  if (/^\/api\/ocr-image(?:-layout)?$/.test(pathname)) {
    return 9 * 1024 * 1024;
  }
  if (pathname === "/api/admin/public-articles") {
    return 8 * 1024 * 1024;
  }
  if (pathname === "/api/translate-article") {
    return 512 * 1024;
  }
  if (pathname === "/api/summarize-article") {
    return 128 * 1024;
  }
  return 64 * 1024;
}

function jsonError(message: string, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
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
    if (fetchSite === "cross-site") {
      return jsonError("不允许跨站请求。", 403);
    }

    if (pathname.startsWith("/api/admin/")) {
      const origin = request.headers.get("origin");
      if (!origin && process.env.NODE_ENV === "production") {
        return jsonError("管理操作缺少可信来源。", 403);
      }
      if (origin) {
        try {
          if (new URL(origin).origin !== url.origin) {
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
      });
    }
  }

  return null;
}
