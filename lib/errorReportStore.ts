import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { ensureFeedbackBucket, FEEDBACK_BUCKET, feedbackAdminClient } from "@/lib/feedbackStore";
import type {
  ErrorEmailStatus,
  ErrorReportInput,
  StoredErrorReport,
} from "@/types/errorReport";

const ALERT_TO = "13874807542@163.com";
const EMAIL_SUPPRESSION_MS = 15 * 60 * 1000;

export function isErrorReportObjectPath(value: string): boolean {
  return /^errors\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}-[0-9a-f]{16}\.json$/i.test(value);
}

function clipped(value: unknown, limit: number): string {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeMetadata(value: ErrorReportInput["metadata"]): StoredErrorReport["metadata"] {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, entry]) => {
        const safeKey = clipped(key, 80);
        if (entry === null || typeof entry === "boolean" || typeof entry === "number") {
          return [safeKey, entry];
        }
        return [safeKey, clipped(entry, 500)];
      })
      .filter(([key]) => Boolean(key)),
  );
}

function fingerprintFor(input: ErrorReportInput): string {
  const material = [
    input.operation,
    input.endpoint,
    input.code || "",
    String(input.httpStatus || ""),
    input.category,
    process.env.VERCEL_GIT_COMMIT_SHA || "",
  ].join("\n");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function reportPath(createdAt: string, fingerprint: string): string {
  return `errors/${createdAt.slice(0, 7)}/${createdAt.slice(0, 10)}-${fingerprint}.json`;
}

async function readExistingReport(
  client: ReturnType<typeof feedbackAdminClient>,
  path: string,
): Promise<StoredErrorReport | null> {
  const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(path);
  if (error) {
    if (/not found|does not exist|404/i.test(error.message)) return null;
    throw error;
  }
  const parsed = JSON.parse(await data.text()) as StoredErrorReport;
  return parsed?.id ? parsed : null;
}

function reportText(report: StoredErrorReport): string {
  const metadata = Object.entries(report.metadata || {})
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
  return [
    `[${report.severity.toUpperCase()}] Context Reader 自动错误告警`,
    "",
    `错误编号: ${report.id}`,
    `首次发生: ${report.createdAt}`,
    `最近发生: ${report.lastSeenAt}`,
    `累计次数: ${report.occurrenceCount}`,
    `分类: ${report.category}`,
    `操作: ${report.operation}`,
    `接口: ${report.endpoint || "未记录"}`,
    `HTTP 状态: ${report.httpStatus || "未记录"}`,
    `错误代码: ${report.code || "未记录"}`,
    `页面: ${report.page || "未记录"}`,
    `用户 ID: ${report.userId || "游客或未知"}`,
    `昵称: ${report.nickname || "未记录"}`,
    `版本: ${report.release || "未记录"}`,
    `部署: ${report.deploymentUrl || "未记录"}`,
    "",
    `用户提示: ${report.userMessage}`,
    `技术信息: ${report.technicalMessage}`,
    report.stack ? `\n堆栈:\n${report.stack}` : "",
    metadata ? `\n附加信息:\n${metadata}` : "",
    "",
    "请前往 /admin?section=errors 查看、处理和标记。",
  ].filter(Boolean).join("\n");
}

async function sendViaSmtp(subject: string, text: string): Promise<boolean> {
  const host = process.env.ERROR_ALERT_SMTP_HOST?.trim() || "";
  const user = process.env.ERROR_ALERT_SMTP_USER?.trim() || "";
  const pass = process.env.ERROR_ALERT_SMTP_PASSWORD?.trim() || "";
  if (!host || !user || !pass) return false;

  const port = Number(process.env.ERROR_ALERT_SMTP_PORT || "465");
  const transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 465,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  });
  await transporter.sendMail({
    from: process.env.ERROR_ALERT_FROM?.trim() || user,
    to: ALERT_TO,
    subject,
    text,
  });
  return true;
}

async function sendViaResend(subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const from = process.env.ERROR_ALERT_FROM?.trim() || "";
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [ALERT_TO], subject, text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 500)}`);
  }
  return true;
}

async function deliverAlert(report: StoredErrorReport): Promise<{
  status: ErrorEmailStatus;
  error: string;
}> {
  const subject = `[Context Reader ${report.severity === "critical" ? "紧急" : "异常"}] ${report.operation} · ${report.id}`;
  const text = reportText(report);
  try {
    if (await sendViaSmtp(subject, text)) return { status: "sent", error: "" };
    if (await sendViaResend(subject, text)) return { status: "sent", error: "" };
    return { status: "not_configured", error: "未配置 SMTP 或 Resend 告警通道。" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? clipped(error.message, 1_000) : "邮件发送失败。",
    };
  }
}

async function uploadReport(
  client: ReturnType<typeof feedbackAdminClient>,
  report: StoredErrorReport,
): Promise<void> {
  const { error } = await client.storage.from(FEEDBACK_BUCKET).upload(
    report.objectPath,
    Buffer.from(JSON.stringify(report, null, 2)),
    { contentType: "application/json", cacheControl: "0", upsert: true },
  );
  if (error) throw error;
}

export async function storeErrorReport(
  input: ErrorReportInput,
  context: { userId?: string; nickname?: string; userAgent?: string } = {},
): Promise<StoredErrorReport> {
  const now = new Date().toISOString();
  const normalized: ErrorReportInput = {
    category: input.category,
    severity: input.severity,
    operation: clipped(input.operation, 120) || "unknown_operation",
    endpoint: clipped(input.endpoint, 300),
    page: clipped(input.page, 500),
    userMessage: clipped(input.userMessage, 1_000),
    technicalMessage: clipped(input.technicalMessage, 4_000),
    code: clipped(input.code, 120),
    httpStatus: Number.isFinite(input.httpStatus) ? Math.max(0, Number(input.httpStatus)) : 0,
    stack: clipped(input.stack, 8_000),
    metadata: normalizeMetadata(input.metadata),
  };
  const fingerprint = fingerprintFor(normalized);
  const objectPath = reportPath(now, fingerprint);
  const client = feedbackAdminClient();
  await ensureFeedbackBucket(client);
  const existing = await readExistingReport(client, objectPath);
  const previousEmailAt = Date.parse(existing?.lastEmailAt || "");
  const shouldEmail = !existing
    || !Number.isFinite(previousEmailAt)
    || Date.now() - previousEmailAt >= EMAIL_SUPPRESSION_MS;

  let report: StoredErrorReport = {
    ...normalized,
    id: existing?.id || `CR-${now.slice(0, 10).replace(/-/g, "")}-${fingerprint.slice(0, 8).toUpperCase()}`,
    fingerprint,
    createdAt: existing?.createdAt || now,
    lastSeenAt: now,
    occurrenceCount: (existing?.occurrenceCount || 0) + 1,
    status: existing?.status === "resolved" ? "new" : existing?.status || "new",
    resolvedAt: "",
    objectPath,
    userId: clipped(context.userId || existing?.userId, 120),
    nickname: clipped(context.nickname || existing?.nickname, 120),
    userAgent: clipped(context.userAgent || existing?.userAgent, 500),
    release: clipped(process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, 120),
    deploymentUrl: clipped(process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL, 300),
    emailStatus: shouldEmail ? "suppressed" : existing?.emailStatus || "suppressed",
    emailError: shouldEmail ? "" : existing?.emailError || "",
    lastEmailAt: existing?.lastEmailAt || "",
  };

  // Persist the diagnostic before attempting email so a mail-provider failure
  // can never erase the Admin-side record.
  await uploadReport(client, report);

  if (shouldEmail) {
    const delivery = await deliverAlert(report);
    report = {
      ...report,
      emailStatus: delivery.status,
      emailError: delivery.error,
      lastEmailAt: delivery.status === "sent" ? now : report.lastEmailAt,
    };
    await uploadReport(client, report);
  }

  return report;
}
