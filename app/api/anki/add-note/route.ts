import { NextResponse } from "next/server";
import { AnkiConnectError, addVocabularyNote } from "@/lib/ankiConnect";
import { DEFAULT_ANKI_DECK } from "@/lib/ankiTemplates";
import { normalizeVocabularyEntries } from "@/lib/vocabulary";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
    deckName?: string;
    entry?: unknown;
  } | null;

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
