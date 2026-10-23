import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { DOCUMENT_BUCKET } from "@/lib/documentStore";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请登录后打开文档。" }, { status: 401 });
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  if (!/^[a-f0-9]{64}$/.test(id) || (format !== "pdf" && format !== "docx")) return new Response(null, { status: 400 });
  const page = new URL(request.url).searchParams.get("page");
  if (page !== null) {
    if (format !== "pdf" || !/^[1-9]\d{0,2}$/.test(page) || Number(page) > 500) return new Response(null, { status: 400 });
    try {
      const { readDocumentPage } = await import("@/lib/documentPageStore");
      const bytes = await readDocumentPage(user.id, id, Number(page), new URL(request.url).searchParams.get("preview") === "1");
      return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
      // A source with document-level forms/color/layer state must keep using
      // the intact PDF. The reader silently falls back to its existing path.
      return new Response(null, { status: 422 });
    }
  }
  const range = request.headers.get("range");
  if (range && !/^bytes=\d+-\d*$/.test(range)) return new Response(null, { status: 416 });
  // Stream the private owner-scoped object instead of buffering it in the app
  // and then buffering it a second time in the browser before PDF.js can start.
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const upstream = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${user.id}/${id}.${format}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(range ? { Range: range } : {}) },
      cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]),
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return NextResponse.json({ error: "文档暂时无法读取，请检查网络后重试。" }, { status: upstream.status === 416 ? 416 : [400,403,404].includes(upstream.status) ? 404 : 502 });
    }
    const headers = new Headers({ "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="document.${format}"` });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      if (name === "content-length" && upstream.headers.has("content-encoding")) continue;
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: "文档暂时无法读取，请检查网络后重试。" }, { status: 502 });
  }
}
