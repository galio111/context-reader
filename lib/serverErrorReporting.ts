import "server-only";

import { storeErrorReport } from "@/lib/errorReportStore";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type {
  ErrorReportCategory,
  ErrorReportSeverity,
  StoredErrorReport,
} from "@/types/errorReport";

type ReportMetadata = StoredErrorReport["metadata"];

export async function recordServerError(
  request: Request,
  input: {
    category: ErrorReportCategory;
    severity?: ErrorReportSeverity;
    operation: string;
    endpoint: string;
    userMessage: string;
    technicalMessage?: string;
    code?: string;
    httpStatus: number;
    metadata?: ReportMetadata;
  },
  error?: unknown,
): Promise<StoredErrorReport | null> {
  const user = await getAuthenticatedUser().catch(() => null);
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : "";
  const stack = error instanceof Error ? error.stack || "" : "";
  try {
    return await storeErrorReport({
      category: input.category,
      severity: input.severity || "error",
      operation: input.operation,
      endpoint: input.endpoint,
      page: request.headers.get("referer") || "",
      userMessage: input.userMessage,
      technicalMessage: input.technicalMessage || errorMessage || `HTTP ${input.httpStatus}`,
      code: input.code || (error instanceof Error ? error.name : ""),
      httpStatus: input.httpStatus,
      stack,
      metadata: input.metadata || {},
    }, {
      userId: user?.id || "",
      nickname: typeof user?.user_metadata?.nickname === "string" ? user.user_metadata.nickname : "",
      userAgent: request.headers.get("user-agent") || "",
    });
  } catch (reportError) {
    console.error("Server error reporting failed", reportError);
    return null;
  }
}

export function reportReference(report: StoredErrorReport | null): { reportId?: string } {
  return report ? { reportId: report.id } : {};
}
