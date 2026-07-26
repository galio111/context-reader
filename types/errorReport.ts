export type ErrorReportCategory =
  | "client"
  | "service"
  | "provider"
  | "configuration"
  | "unknown";

export type ErrorReportSeverity = "warning" | "error" | "critical";
export type ErrorReportStatus = "new" | "resolved";
export type ErrorEmailStatus = "sent" | "failed" | "not_configured" | "suppressed";

export interface ErrorReportInput {
  category: ErrorReportCategory;
  severity: ErrorReportSeverity;
  operation: string;
  endpoint: string;
  page: string;
  userMessage: string;
  technicalMessage: string;
  code?: string;
  httpStatus?: number;
  stack?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface StoredErrorReport extends ErrorReportInput {
  id: string;
  fingerprint: string;
  createdAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  status: ErrorReportStatus;
  resolvedAt: string;
  objectPath: string;
  userId: string;
  nickname: string;
  userAgent: string;
  release: string;
  deploymentUrl: string;
  emailStatus: ErrorEmailStatus;
  emailError: string;
  lastEmailAt: string;
}
