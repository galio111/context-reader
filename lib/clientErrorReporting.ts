"use client";

import type {
  ErrorReportCategory,
  ErrorReportInput,
  ErrorReportSeverity,
} from "@/types/errorReport";

type ErrorMetadata = NonNullable<ErrorReportInput["metadata"]>;

export interface ClientErrorContext {
  operation: string;
  endpoint?: string;
  fallbackMessage: string;
  metadata?: ErrorMetadata;
}

interface ErrorReportResponse {
  id?: string;
  emailStatus?: string;
}

function errorIdSuffix(id?: string): string {
  return id ? ` 错误编号：${id}` : "";
}

function isFetchTransportError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(error.message));
}

function responseError(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const candidate = (data as { error?: unknown }).error;
  return typeof candidate === "string" ? candidate.trim() : "";
}

function responseReportId(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const candidate = (data as { reportId?: unknown }).reportId;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export async function reportClientIssue(input: {
  category?: ErrorReportCategory;
  severity?: ErrorReportSeverity;
  operation: string;
  endpoint?: string;
  userMessage: string;
  technicalMessage: string;
  code?: string;
  httpStatus?: number;
  stack?: string;
  metadata?: ErrorMetadata;
}): Promise<ErrorReportResponse | null> {
  if (typeof window === "undefined" || navigator.onLine === false) return null;
  try {
    const response = await fetch("/api/error-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      keepalive: true,
      body: JSON.stringify({
        category: input.category || "client",
        severity: input.severity || "error",
        operation: input.operation,
        endpoint: input.endpoint || "",
        page: window.location.href,
        userMessage: input.userMessage,
        technicalMessage: input.technicalMessage,
        code: input.code || "",
        httpStatus: input.httpStatus || 0,
        stack: input.stack || "",
        metadata: input.metadata || {},
      }),
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as ErrorReportResponse | null;
  } catch {
    return null;
  }
}

export async function describeCaughtRequestError(
  error: unknown,
  context: ClientErrorContext,
): Promise<string> {
  if (error instanceof Error && error.name === "AbortError") {
    return "请求已取消或等待超时。请稍后重试；如果多次出现，可能是网络或服务响应过慢。";
  }

  if (isFetchTransportError(error)) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "当前没有网络连接。请检查 Wi-Fi、移动网络或代理设置，然后重试。";
    }
    return "无法连接到 Context Reader。请检查网络或代理设置；如果其他网站可以正常访问，本站可能暂时不可用，请稍后重试。";
  }

  const technicalMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : "";
  const reported = await reportClientIssue({
    category: "client",
    operation: context.operation,
    endpoint: context.endpoint,
    userMessage: context.fallbackMessage,
    technicalMessage,
    stack,
    metadata: context.metadata,
  });
  return reported?.id
    ? `页面处理结果时出现异常。开发者已收到问题并正在处理，请稍后重试。${errorIdSuffix(reported.id)}`
    : "页面处理结果时出现异常，请稍后重试。自动错误上报暂时没有成功；如果问题持续出现，请通过意见反馈告知开发者。";
}

export async function describeApiFailure(
  response: Response,
  data: unknown,
  context: ClientErrorContext,
): Promise<string> {
  const serverMessage = responseError(data);
  const existingReportId = responseReportId(data);

  if (response.status < 500) {
    if (response.status === 429) {
      return serverMessage || "当前请求较多或额度已用完，请稍后重试并查看页面上的用量说明。";
    }
    if (response.status === 401) return serverMessage || "登录状态已失效，请重新登录后再试。";
    if (response.status === 403) return serverMessage || "当前账号没有执行这个操作的权限。";
    return serverMessage || context.fallbackMessage;
  }

  let reportId = existingReportId;
  if (!reportId) {
    const reported = await reportClientIssue({
      category: response.status === 502 || response.status === 503 ? "provider" : "service",
      operation: context.operation,
      endpoint: context.endpoint,
      userMessage: "服务暂时不可用，开发者已收到异常并正在处理。",
      technicalMessage: serverMessage || `API returned HTTP ${response.status}`,
      code: `HTTP_${response.status}`,
      httpStatus: response.status,
      metadata: context.metadata,
    });
    reportId = reported?.id || "";
  }

  return reportId
    ? `服务暂时不可用。开发者已收到异常并正在处理，请稍后重试。${errorIdSuffix(reportId)}`
    : "服务暂时不可用，请稍后重试。自动错误上报暂时没有成功；如果问题持续出现，请通过意见反馈告知开发者。";
}

export async function describeClientFailure(
  technicalMessage: string,
  context: ClientErrorContext,
): Promise<string> {
  const reported = await reportClientIssue({
    category: "client",
    operation: context.operation,
    endpoint: context.endpoint,
    userMessage: context.fallbackMessage,
    technicalMessage,
    metadata: context.metadata,
  });
  return reported?.id
    ? `页面没有正确处理服务返回的结果。开发者已收到问题并正在处理，请稍后重试。${errorIdSuffix(reported.id)}`
    : "页面没有正确处理服务返回的结果，请稍后重试。自动错误上报暂时没有成功；如果问题持续出现，请通过意见反馈告知开发者。";
}

export function validateStandaloneDictionaryInput(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "请输入要查询的英文单词或短语。";
  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(normalized)) {
    return "单独查词目前只支持英文单词或英文短语，暂不支持中文查英文。中译英功能之后会开放。";
  }
  if (/[.!?。！？;；]/u.test(normalized) || normalized.split(" ").length > 8) {
    return "这看起来是一整句话。单独查词目前只支持英文单词或不超过 8 个词的英文短语；句子请放到文章中选择后查询。";
  }
  if (!/^[A-Za-z][A-Za-z'’ -]*$/u.test(normalized)) {
    return "请输入英文单词或不超过 8 个词的英文短语，暂不支持数字和其他符号。";
  }
  return "";
}
