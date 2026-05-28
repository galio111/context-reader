import { NextResponse } from "next/server";
import { AnkiConnectError, getDeckNames } from "@/lib/ankiConnect";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  try {
    const decks = await getDeckNames(body.endpoint);
    return NextResponse.json({ decks });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "获取 Anki deck 列表失败。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
