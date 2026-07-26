import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { isErrorReportObjectPath } from "@/lib/errorReportStore";
import { FEEDBACK_BUCKET, feedbackAdminClient } from "@/lib/feedbackStore";
import { readJsonBody } from "@/lib/limitedBody";
import type { StoredErrorReport } from "@/types/errorReport";

export const runtime = "nodejs";

async function bucketExists(client: ReturnType<typeof feedbackAdminClient>): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(FEEDBACK_BUCKET);
  if (data) return true;
  if (error && !/not found|does not exist/i.test(error.message)) throw error;
  return false;
}

async function listErrorPaths(client: ReturnType<typeof feedbackAdminClient>): Promise<string[]> {
  const { data: folders, error } = await client.storage.from(FEEDBACK_BUCKET).list("errors", {
    limit: 100,
    sortBy: { column: "name", order: "desc" },
  });
  if (error) throw error;
  const months = (folders ?? [])
    .map((item) => item.name)
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((left, right) => right.localeCompare(left));
  const paths: string[] = [];
  for (const month of months) {
    for (let offset = 0; offset < 1_000 && paths.length < 500; offset += 100) {
      const { data: files, error: listError } = await client.storage.from(FEEDBACK_BUCKET).list(`errors/${month}`, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "desc" },
      });
      if (listError) throw listError;
      paths.push(
        ...(files ?? [])
          .map((item) => `errors/${month}/${item.name}`)
          .filter(isErrorReportObjectPath),
      );
      if ((files ?? []).length < 100) break;
    }
    if (paths.length >= 500) break;
  }
  return paths.slice(0, 500);
}

async function readReport(
  client: ReturnType<typeof feedbackAdminClient>,
  path: string,
): Promise<StoredErrorReport | null> {
  const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(path);
  if (error) throw error;
  const input = JSON.parse(await data.text()) as Partial<StoredErrorReport>;
  if (!input.id || !input.createdAt || !input.technicalMessage) return null;
  return {
    category: input.category || "unknown",
    severity: input.severity || "error",
    operation: String(input.operation || "unknown_operation"),
    endpoint: String(input.endpoint || ""),
    page: String(input.page || ""),
    userMessage: String(input.userMessage || ""),
    technicalMessage: String(input.technicalMessage),
    code: String(input.code || ""),
    httpStatus: Number(input.httpStatus) || 0,
    stack: String(input.stack || ""),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    id: String(input.id),
    fingerprint: String(input.fingerprint || ""),
    createdAt: String(input.createdAt),
    lastSeenAt: String(input.lastSeenAt || input.createdAt),
    occurrenceCount: Math.max(1, Number(input.occurrenceCount) || 1),
    status: input.status === "resolved" ? "resolved" : "new",
    resolvedAt: String(input.resolvedAt || ""),
    objectPath: path,
    userId: String(input.userId || ""),
    nickname: String(input.nickname || ""),
    userAgent: String(input.userAgent || ""),
    release: String(input.release || ""),
    deploymentUrl: String(input.deploymentUrl || ""),
    emailStatus: input.emailStatus || "not_configured",
    emailError: String(input.emailError || ""),
    lastEmailAt: String(input.lastEmailAt || ""),
  };
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  try {
    const client = feedbackAdminClient();
    if (!(await bucketExists(client))) {
      return NextResponse.json({ reports: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const paths = await listErrorPaths(client);
    const reports: StoredErrorReport[] = [];
    for (let index = 0; index < paths.length; index += 20) {
      const batch = await Promise.all(
        paths.slice(index, index + 20).map((path) => readReport(client, path).catch(() => null)),
      );
      reports.push(...batch.filter((item): item is StoredErrorReport => Boolean(item)));
    }
    reports.sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
    return NextResponse.json({ reports }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin error report listing failed", error);
    return NextResponse.json({ error: "错误记录读取失败，请稍后重试。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8 * 1024).catch(() => null);
  const path = typeof body?.path === "string" ? body.path : "";
  const status = body?.status === "resolved" ? "resolved" : body?.status === "new" ? "new" : "";
  if (!isErrorReportObjectPath(path) || !status) {
    return NextResponse.json({ error: "错误状态更新格式无效。" }, { status: 400 });
  }
  try {
    const client = feedbackAdminClient();
    const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(path);
    if (error) throw error;
    const report = JSON.parse(await data.text()) as StoredErrorReport;
    report.status = status;
    report.resolvedAt = status === "resolved" ? new Date().toISOString() : "";
    const { error: uploadError } = await client.storage.from(FEEDBACK_BUCKET).upload(
      path,
      Buffer.from(JSON.stringify(report, null, 2)),
      { contentType: "application/json", cacheControl: "0", upsert: true },
    );
    if (uploadError) throw uploadError;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin error report update failed", error);
    return NextResponse.json({ error: "错误状态更新失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path") || "";
  if (!isErrorReportObjectPath(path)) {
    return NextResponse.json({ error: "错误记录路径无效。" }, { status: 400 });
  }
  try {
    const client = feedbackAdminClient();
    const { error } = await client.storage.from(FEEDBACK_BUCKET).remove([path]);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin error report deletion failed", error);
    return NextResponse.json({ error: "错误记录删除失败。" }, { status: 500 });
  }
}
