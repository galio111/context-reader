import { NextResponse } from "next/server";
import { ensureFeedbackBucket, FEEDBACK_BUCKET, feedbackAdminClient } from "@/lib/feedbackStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export const runtime = "nodejs";

const feedbackWindows = new Map<string, { count: number; resetAt: number }>();

function allowFeedback(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 80);
  const key = `${forwarded}:${userAgent}`;
  const now = Date.now();
  const current = feedbackWindows.get(key);
  if (!current || current.resetAt <= now) {
    feedbackWindows.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const expectedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return Boolean(expectedHost && new URL(origin).host === expectedHost);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "反馈请求来源无效。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, 12 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "反馈内容过长。" }, { status: 413 });
    }
    return NextResponse.json({ error: "反馈内容格式不正确。" }, { status: 400 });
  }

  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 3000) : "";
  const category = typeof input.category === "string" ? input.category.trim().slice(0, 40) : "产品建议";
  const contact = typeof input.contact === "string" ? input.contact.trim().slice(0, 160) : "";
  const page = typeof input.page === "string" ? input.page.trim().slice(0, 300) : "";
  const website = typeof input.website === "string" ? input.website.trim() : "";
  if (website) return NextResponse.json({ ok: true });
  if (message.length < 10) {
    return NextResponse.json({ error: "请至少写 10 个字，让建议更容易被理解。" }, { status: 400 });
  }
  if (!allowFeedback(request)) {
    return NextResponse.json({ error: "提交得有些频繁，请稍后再试。" }, { status: 429 });
  }

  try {
    const client = feedbackAdminClient();
    await ensureFeedbackBucket(client);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const objectPath = `${createdAt.slice(0, 7)}/${createdAt.slice(0, 10)}-${id}.json`;
    const payload = JSON.stringify({
      id,
      createdAt,
      category,
      message,
      contact,
      page,
      userAgent: (request.headers.get("user-agent") || "").slice(0, 300),
    }, null, 2);
    const { error } = await client.storage.from(FEEDBACK_BUCKET).upload(objectPath, Buffer.from(payload), {
      contentType: "application/json",
      upsert: false,
      cacheControl: "0",
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("Feedback storage failed", error);
    return NextResponse.json({ error: "反馈暂时没有送达，请稍后再试。" }, { status: 500 });
  }
}
