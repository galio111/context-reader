import { NextResponse } from "next/server";
import { ensureFeedbackBucket, FEEDBACK_BUCKET, feedbackAdminClient } from "@/lib/feedbackStore";
import { readFormDataBody, readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export const runtime = "nodejs";

const feedbackWindows = new Map<string, { count: number; resetAt: number }>();
const MAX_FEEDBACK_IMAGES = 3;
const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FEEDBACK_REQUEST_BYTES = 16 * 1024 * 1024;
const feedbackImageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

interface FeedbackInput {
  category: string;
  message: string;
  contact: string;
  page: string;
  website: string;
  images: File[];
}

async function readFeedbackInput(request: Request): Promise<FeedbackInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await readFormDataBody(request, MAX_FEEDBACK_REQUEST_BYTES);
    return {
      category: String(form.get("category") || ""),
      message: String(form.get("message") || ""),
      contact: String(form.get("contact") || ""),
      page: String(form.get("page") || ""),
      website: String(form.get("website") || ""),
      images: form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0),
    };
  }
  const body = await readJsonBody<unknown>(request, 12 * 1024);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    category: typeof input.category === "string" ? input.category : "",
    message: typeof input.message === "string" ? input.message : "",
    contact: typeof input.contact === "string" ? input.contact : "",
    page: typeof input.page === "string" ? input.page : "",
    website: typeof input.website === "string" ? input.website : "",
    images: [],
  };
}

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

  let rawInput: FeedbackInput;
  try {
    rawInput = await readFeedbackInput(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "反馈内容或图片过大。" }, { status: 413 });
    }
    return NextResponse.json({ error: "反馈内容格式不正确。" }, { status: 400 });
  }

  const message = rawInput.message.trim().slice(0, 3000);
  const category = rawInput.category.trim().slice(0, 40) || "产品建议";
  const contact = rawInput.contact.trim().slice(0, 160);
  const page = rawInput.page.trim().slice(0, 300);
  const website = rawInput.website.trim();
  if (website) return NextResponse.json({ ok: true });
  if (message.length < 10) {
    return NextResponse.json({ error: "请至少写 10 个字，让建议更容易被理解。" }, { status: 400 });
  }
  if (!allowFeedback(request)) {
    return NextResponse.json({ error: "提交得有些频繁，请稍后再试。" }, { status: 429 });
  }
  if (rawInput.images.length > MAX_FEEDBACK_IMAGES) {
    return NextResponse.json({ error: `最多上传 ${MAX_FEEDBACK_IMAGES} 张图片。` }, { status: 400 });
  }
  for (const image of rawInput.images) {
    if (!feedbackImageExtensions[image.type]) {
      return NextResponse.json({ error: "图片仅支持 JPG、PNG、WebP 或 GIF。" }, { status: 400 });
    }
    if (image.size > MAX_FEEDBACK_IMAGE_BYTES) {
      return NextResponse.json({ error: "单张图片不能超过 5MB。" }, { status: 413 });
    }
  }

  const uploadedPaths: string[] = [];
  try {
    const client = feedbackAdminClient();
    await ensureFeedbackBucket(client);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const month = createdAt.slice(0, 7);
    const objectPath = `${month}/${createdAt.slice(0, 10)}-${id}.json`;
    const attachments = [];
    for (let index = 0; index < rawInput.images.length; index += 1) {
      const image = rawInput.images[index];
      const extension = feedbackImageExtensions[image.type];
      const attachmentPath = `${month}/attachments/${id}/${index + 1}.${extension}`;
      const { error: imageError } = await client.storage.from(FEEDBACK_BUCKET).upload(
        attachmentPath,
        Buffer.from(await image.arrayBuffer()),
        {
          contentType: image.type,
          upsert: false,
          cacheControl: "0",
        },
      );
      if (imageError) throw imageError;
      uploadedPaths.push(attachmentPath);
      attachments.push({
        path: attachmentPath,
        name: image.name.slice(0, 160),
        type: image.type,
        size: image.size,
      });
    }
    const payload = JSON.stringify({
      id,
      createdAt,
      category,
      message,
      contact,
      page,
      attachments,
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
    if (uploadedPaths.length) {
      try {
        await feedbackAdminClient().storage.from(FEEDBACK_BUCKET).remove(uploadedPaths);
      } catch {
        // Best-effort cleanup only; the private orphan is not listed without its JSON record.
      }
    }
    return NextResponse.json({ error: "反馈暂时没有送达，请稍后再试。" }, { status: 500 });
  }
}
