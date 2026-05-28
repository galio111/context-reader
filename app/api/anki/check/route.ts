import { NextResponse } from "next/server";
import { AnkiConnectError, checkAnki } from "@/lib/ankiConnect";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  try {
    const version = await checkAnki(body.endpoint);
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "AnkiConnect 检测失败，请稍后重试。";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
