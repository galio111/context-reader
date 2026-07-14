import { NextResponse } from "next/server";
import { AnkiConnectError, getModelNames } from "@/lib/ankiConnect";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function POST(request: Request) {
  let body: { endpoint?: string };
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式无效。" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  try {
    const models = await getModelNames(body.endpoint);
    return NextResponse.json({ models });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "获取 Anki note type 列表失败。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
