import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";

export const runtime = "nodejs";

const BUCKET = "public-article-covers";
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    throw new Error("Supabase 存储尚未配置。");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureCoverBucket(client: ReturnType<typeof supabaseAdmin>) {
  const { data } = await client.storage.getBucket(BUCKET);
  if (data) {
    return;
  }
  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_COVER_BYTES,
    allowedMimeTypes: [...ALLOWED_TYPES.keys()],
  });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_COVER_BYTES + 256 * 1024) {
    return NextResponse.json({ error: "封面图片不能超过 5MB。" }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择封面图片。" }, { status: 400 });
    }
    const extension = ALLOWED_TYPES.get(file.type);
    if (!extension || file.size <= 0 || file.size > MAX_COVER_BYTES) {
      return NextResponse.json({ error: "仅支持 5MB 以内的 JPG、PNG、WebP 或 AVIF 图片。" }, { status: 400 });
    }

    const client = supabaseAdmin();
    await ensureCoverBucket(client);
    const date = new Date().toISOString().slice(0, 10);
    const objectPath = `${date}/${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await client.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) {
      throw error;
    }
    const { data } = client.storage.from(BUCKET).getPublicUrl(objectPath);
    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    console.error("Admin cover upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "封面上传失败。" },
      { status: 500 },
    );
  }
}
