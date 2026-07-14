import { NextResponse } from "next/server";
import { AnkiConnectError, addVocabularyNote } from "@/lib/ankiConnect";
import { DEFAULT_ANKI_DECK } from "@/lib/ankiTemplates";
import { normalizeVocabularyEntries } from "@/lib/vocabulary";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function POST(request: Request) {
  let body: {
    endpoint?: string;
    deckName?: string;
    entry?: unknown;
  } | null;
  try {
    body = await readJsonBody(request, 128 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式无效。" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }

  const entry = normalizeVocabularyEntries(body?.entry ? [body.entry] : [])[0];
  if (!entry) {
    return NextResponse.json({ error: "缺少有效的生词数据，无法导入 Anki。" }, { status: 400 });
  }

  try {
    const ankiNoteId = await addVocabularyNote(
      entry,
      body?.deckName?.trim() || DEFAULT_ANKI_DECK,
      body?.endpoint,
    );
    return NextResponse.json({ ankiNoteId });
  } catch (error) {
    const message =
      error instanceof AnkiConnectError ? error.message : "添加 Anki note 失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
