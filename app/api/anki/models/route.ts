import { NextResponse } from "next/server";
import { AnkiConnectError, getModelNames } from "@/lib/ankiConnect";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  try {
    const models = await getModelNames(body.endpoint);
    return NextResponse.json({ models });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "获取 Anki note type 列表失败。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
