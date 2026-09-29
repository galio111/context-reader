import { NextResponse } from "next/server";
import { getAdminAccessMode } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { readCetPaperWithOverrides, saveCetPaperParagraphs } from "@/lib/cetPaperOverrides";

const paperIdPattern = /^cet[46]-\d{4}-\d{2}-[1-3]$/;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}

export async function GET(request: Request) {
  if (await getAdminAccessMode() !== "developer") return NextResponse.json({ error: "仅开发者可编辑真题排版。" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!paperIdPattern.test(id)) return NextResponse.json({ error: "试卷编号无效。" }, { status: 400 });
  try {
    const { paper, revision } = await readCetPaperWithOverrides(id);
    return NextResponse.json({ paper, revision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "试卷暂不可用。" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (await getAdminAccessMode() !== "developer") return NextResponse.json({ error: "仅开发者可编辑真题排版。" }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  const body = await readJsonBody<Record<string, unknown>>(request, 120_000).catch(() => null);
  const paperId = body?.paperId;
  const sectionId = body?.sectionId;
  const paragraphs = body?.paragraphs;
  const expectedRevision = body?.expectedRevision;
  if (typeof paperId !== "string" || !paperIdPattern.test(paperId) || typeof sectionId !== "string" || sectionId.length > 100
    || !Array.isArray(paragraphs) || paragraphs.length < 1 || paragraphs.length > 100
    || !paragraphs.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 20_000)
    || !(expectedRevision === null || typeof expectedRevision === "string" && expectedRevision.length <= 50)) {
    return NextResponse.json({ error: "排版内容无效；每段都需要保留文字。" }, { status: 400 });
  }
  try {
    const result = await saveCetPaperParagraphs({ paperId, sectionId, paragraphs, expectedRevision });
    if (result === "conflict") return NextResponse.json({ error: "此题已由另一处更新，请重新载入后再编辑。" }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const invalid = message === "填空编号不能改变。" || message.startsWith("正文变动过大");
    return NextResponse.json({ error: invalid ? message : "排版保存失败，请重试。" }, { status: invalid ? 400 : 503 });
  }
}
