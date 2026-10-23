import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { readFormDataBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { MAX_DOCUMENT_BYTES } from "@/lib/documentSource";
import { validateDocumentBytes } from "@/lib/documentValidation";
import { DOCUMENT_BUCKET, documentStore, ensureDocumentBucket } from "@/lib/documentStore";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && new URL(origin).host === (request.headers.get("x-forwarded-host") || request.headers.get("host"))); } catch { /* Reject malformed origins. */ }
  if (!sameOrigin) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "登录后才能导入并保存文档。" }, { status: 401 });
  let bytes: Uint8Array, format: "pdf" | "docx", name: string;
  try {
    const form = await readFormDataBody(request, MAX_DOCUMENT_BYTES + 16384);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择 PDF 或 Word 文件。");
    name = file.name.slice(0, 240);
    const extension = name.split(".").pop()?.toLowerCase();
    if (extension !== "pdf" && extension !== "docx") throw new Error("支持 PDF 和 .docx；旧版 .doc 请先另存为 .docx。");
    format = extension;
    bytes = new Uint8Array(await file.arrayBuffer());
    validateDocumentBytes(bytes, format);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? "文档不能超过 50MB。" : error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : "上传内容不完整，请重新选择文档后重试。" }, { status: 400 });
  }
  try {
    const client = documentStore();
    await ensureDocumentBucket(client);
    const id = createHash("sha256").update(bytes).digest("hex");
    const path = `${user.id}/${id}.${format}`;
    const { error } = await client.storage.from(DOCUMENT_BUCKET).upload(path, bytes, {
      contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: true,
    });
    if (error) throw error;
    return NextResponse.json({ document: { id, format, name } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "文档暂时未能保存，请稍后重试。" }, { status: 503 });
  }
}
