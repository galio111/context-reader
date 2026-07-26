import { NextResponse } from "next/server";
import { storeErrorReport } from "@/lib/errorReportStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type { ErrorReportCategory, ErrorReportInput, ErrorReportSeverity } from "@/types/errorReport";

export const runtime = "nodejs";

const reportWindows = new Map<string, { count: number; resetAt: number }>();
const categories = new Set<ErrorReportCategory>(["client", "service", "provider", "configuration", "unknown"]);
const severities = new Set<ErrorReportSeverity>(["warning", "error", "critical"]);

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return Boolean(host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

function allowReport(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = reportWindows.get(ip);
  if (!current || current.resetAt <= now) {
    reportWindows.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "错误上报来源无效。" }, { status: 403 });
  }
  if (!allowReport(request)) {
    return NextResponse.json({ error: "错误上报过于频繁。" }, { status: 429 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "错误信息过大。" : "错误信息格式无效。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const category = categories.has(raw.category as ErrorReportCategory)
    ? raw.category as ErrorReportCategory
    : "unknown";
  const severity = severities.has(raw.severity as ErrorReportSeverity)
    ? raw.severity as ErrorReportSeverity
    : "error";
  const operation = stringValue(raw.operation);
  const technicalMessage = stringValue(raw.technicalMessage);
  if (!operation || !technicalMessage) {
    return NextResponse.json({ error: "错误上报缺少操作或技术信息。" }, { status: 400 });
  }

  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
    ? raw.metadata as ErrorReportInput["metadata"]
    : {};
  const user = await getAuthenticatedUser().catch(() => null);
  try {
    const report = await storeErrorReport({
      category,
      severity,
      operation,
      endpoint: stringValue(raw.endpoint),
      page: stringValue(raw.page),
      userMessage: stringValue(raw.userMessage),
      technicalMessage,
      code: stringValue(raw.code),
      httpStatus: Number(raw.httpStatus) || 0,
      stack: stringValue(raw.stack),
      metadata,
    }, {
      userId: user?.id || "",
      nickname: stringValue(user?.user_metadata?.nickname),
      userAgent: request.headers.get("user-agent") || "",
    });
    return NextResponse.json({
      ok: true,
      id: report.id,
      emailStatus: report.emailStatus,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Automatic error report storage failed", error);
    return NextResponse.json({ error: "错误上报暂时失败。" }, { status: 500 });
  }
}
