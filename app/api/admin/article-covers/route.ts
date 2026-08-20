import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import {
  PUBLIC_COVER_MAX_UPLOAD_BYTES,
  repairExternalPublicArticleCovers,
  storeUploadedPublicCover,
} from "@/lib/publicArticleCovers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > PUBLIC_COVER_MAX_UPLOAD_BYTES + 256 * 1024) {
    return NextResponse.json({ error: "封面图片不能超过 5MB。" }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择封面图片。" }, { status: 400 });
    }
    return NextResponse.json({ url: await storeUploadedPublicCover(file) });
  } catch (error) {
    console.error("Admin cover upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "封面上传失败。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  let body: { ids?: unknown } | null;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch {
    return NextResponse.json({ error: "封面修复请求不是合法 JSON。" }, { status: 400 });
  }
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100)
    : undefined;
  try {
    return NextResponse.json({ result: await repairExternalPublicArticleCovers(ids) });
  } catch (error) {
    console.error("Public cover repair failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公开封面修复失败。" },
      { status: 500 },
    );
  }
}
