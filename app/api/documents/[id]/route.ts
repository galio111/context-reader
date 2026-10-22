import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { DOCUMENT_BUCKET, documentStore } from "@/lib/documentStore";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请登录后打开文档。" }, { status: 401 });
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (!/^[a-f0-9]{64}$/.test(id) || (format !== "pdf" && format !== "docx")) return new Response(null, { status: 400 });
  const { data, error } = await documentStore().storage.from(DOCUMENT_BUCKET).download(`${user.id}/${id}.${format}`);
  if (error || !data) return NextResponse.json({ error: "文档暂时无法读取，请检查网络后重试。" }, { status: 404 });
  return new Response(data, { headers: { "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="document.${format}"` } });
}
