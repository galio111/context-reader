import { NextResponse } from "next/server";
import { AnkiConnectError, ensureModel } from "@/lib/ankiConnect";
import type { AnkiCardMode } from "@/types/anki";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

function isMode(value: unknown): value is AnkiCardMode {
  return value === "cloze_context"
    || value === "basic_cn_to_en"
    || value === "basic_en_to_cn"
    || value === "basic_cn_to_en_dictionary";
}

export async function POST(request: Request) {
  let body: {
    endpoint?: string;
    cardMode?: unknown;
  };
  try {
    body = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式无效。" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }

  if (!isMode(body.cardMode)) {
    return NextResponse.json(
      { error: "cardMode 不是受支持的 Anki 卡片类型。" },
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
