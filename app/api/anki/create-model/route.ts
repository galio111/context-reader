import { NextResponse } from "next/server";
import { AnkiConnectError, ensureModel } from "@/lib/ankiConnect";
import type { AnkiCardMode } from "@/types/anki";

function isMode(value: unknown): value is AnkiCardMode {
  return value === "cloze_context" || value === "basic_cn_to_en";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    cardMode?: unknown;
  };

  if (!isMode(body.cardMode)) {
    return NextResponse.json(
      { error: "cardMode 必须是 cloze_context 或 basic_cn_to_en。" },
      { status: 400 },
    );
  }

  try {
    const modelName = await ensureModel(body.cardMode, body.endpoint);
    return NextResponse.json({ modelName });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "创建 Anki note type 失败。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
