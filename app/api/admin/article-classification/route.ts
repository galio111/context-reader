import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { classifyArticle } from "@/lib/articleClassification";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }

  let body: { title?: unknown; text?: unknown } | null;
  try {
    body = await readJsonBody(request, 600 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "文章内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!title || text.length < 80 || text.length > 500_000) {
    return NextResponse.json({ error: "请提供标题和至少 80 个字符的英文正文。" }, { status: 400 });
  }

  const classification = await classifyArticle(title, text);
  return NextResponse.json({ classification });
}
