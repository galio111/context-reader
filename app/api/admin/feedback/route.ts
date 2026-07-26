import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  FEEDBACK_BUCKET,
  feedbackAdminClient,
  isFeedbackAttachmentPath,
  isFeedbackObjectPath,
} from "@/lib/feedbackStore";
import { readJsonBody } from "@/lib/limitedBody";

export const runtime = "nodejs";

interface StoredFeedback {
  id: string;
  createdAt: string;
  category: string;
  message: string;
  contact: string;
  page: string;
  attachments?: Array<{
    path: string;
    name: string;
    type: string;
    size: number;
  }>;
  status?: "new" | "resolved";
  resolvedAt?: string;
}

async function bucketExists(client: ReturnType<typeof feedbackAdminClient>): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(FEEDBACK_BUCKET);
  if (data) return true;
  if (error && !/not found|does not exist/i.test(error.message)) throw error;
  return false;
}

async function listFeedbackPaths(client: ReturnType<typeof feedbackAdminClient>): Promise<string[]> {
  const { data: folders, error } = await client.storage.from(FEEDBACK_BUCKET).list("", {
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
    for (let offset = 0; offset < 1_000 && paths.length < 300; offset += 100) {
      const { data: files, error: listError } = await client.storage.from(FEEDBACK_BUCKET).list(month, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "desc" },
      });
      if (listError) throw listError;
      const page = (files ?? [])
        .map((item) => `${month}/${item.name}`)
        .filter(isFeedbackObjectPath);
      paths.push(...page);
      if ((files ?? []).length < 100) break;
    }
    if (paths.length >= 300) break;
  }
  return paths.slice(0, 300);
}

async function readFeedback(client: ReturnType<typeof feedbackAdminClient>, path: string) {
  const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(path);
  if (error) throw error;
  const input = JSON.parse(await data.text()) as Partial<StoredFeedback>;
  if (!input.id || !input.createdAt || !input.message) return null;
  return {
    id: String(input.id),
    createdAt: String(input.createdAt),
    category: String(input.category || "产品建议"),
    message: String(input.message),
    contact: String(input.contact || ""),
    page: String(input.page || ""),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.filter((attachment) => (
        attachment
        && isFeedbackAttachmentPath(String(attachment.path || ""))
        && /^image\/(?:jpeg|png|webp|gif)$/.test(String(attachment.type || ""))
      )).slice(0, 3).map((attachment) => ({
        path: String(attachment.path),
        name: String(attachment.name || "用户反馈图片").slice(0, 160),
        type: String(attachment.type),
        size: Number(attachment.size) || 0,
      }))
      : [],
    status: input.status === "resolved" ? "resolved" as const : "new" as const,
    resolvedAt: input.resolvedAt ? String(input.resolvedAt) : "",
    objectPath: path,
  };
}

export async function GET(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  try {
    const client = feedbackAdminClient();
    const attachmentPath = new URL(request.url).searchParams.get("attachment") || "";
    if (attachmentPath) {
      if (!isFeedbackAttachmentPath(attachmentPath)) {
        return NextResponse.json({ error: "反馈图片路径无效。" }, { status: 400 });
      }
      const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(attachmentPath);
      if (error) throw error;
      return new NextResponse(await data.arrayBuffer(), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": data.type || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (!(await bucketExists(client))) {
      return NextResponse.json({ feedback: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const paths = await listFeedbackPaths(client);
    const feedback: Array<NonNullable<Awaited<ReturnType<typeof readFeedback>>>> = [];
    for (let index = 0; index < paths.length; index += 20) {
      const batch = await Promise.all(paths.slice(index, index + 20).map((path) => readFeedback(client, path).catch(() => null)));
      feedback.push(...batch.filter((item): item is NonNullable<typeof item> => Boolean(item)));
    }
    feedback.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return NextResponse.json({ feedback }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin feedback listing failed", error);
    return NextResponse.json({ error: "用户反馈读取失败，请稍后重试。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8 * 1024).catch(() => null);
  const path = typeof body?.path === "string" ? body.path : "";
  const status = body?.status === "resolved" ? "resolved" : body?.status === "new" ? "new" : "";
  if (!isFeedbackObjectPath(path) || !status) {
    return NextResponse.json({ error: "反馈状态更新格式无效。" }, { status: 400 });
  }
  try {
    const client = feedbackAdminClient();
    const { data, error } = await client.storage.from(FEEDBACK_BUCKET).download(path);
    if (error) throw error;
    const feedback = JSON.parse(await data.text()) as Record<string, unknown>;
    feedback.status = status;
    feedback.resolvedAt = status === "resolved" ? new Date().toISOString() : "";
    const { error: uploadError } = await client.storage.from(FEEDBACK_BUCKET).upload(
      path,
      Buffer.from(JSON.stringify(feedback, null, 2)),
      { contentType: "application/json", cacheControl: "0", upsert: true },
    );
    if (uploadError) throw uploadError;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin feedback update failed", error);
    return NextResponse.json({ error: "反馈状态更新失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const path = new URL(request.url).searchParams.get("path") || "";
  if (!isFeedbackObjectPath(path)) return NextResponse.json({ error: "反馈路径无效。" }, { status: 400 });
  try {
    const client = feedbackAdminClient();
    const { data, error: downloadError } = await client.storage.from(FEEDBACK_BUCKET).download(path);
    if (downloadError) throw downloadError;
    const input = JSON.parse(await data.text()) as Partial<StoredFeedback>;
    const attachmentPaths = Array.isArray(input.attachments)
      ? input.attachments.map((attachment) => String(attachment.path || "")).filter(isFeedbackAttachmentPath)
      : [];
    const { error } = await client.storage.from(FEEDBACK_BUCKET).remove([path, ...attachmentPaths]);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin feedback deletion failed", error);
    return NextResponse.json({ error: "反馈删除失败。" }, { status: 500 });
  }
}
