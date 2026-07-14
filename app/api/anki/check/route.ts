import { NextResponse } from "next/server";
import { AnkiConnectError, checkAnki } from "@/lib/ankiConnect";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function POST(request: Request) {
  let body: { endpoint?: string };
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式无效。" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  try {
    const version = await checkAnki(body.endpoint);
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "AnkiConnect 检测失败，请稍后重试。";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
