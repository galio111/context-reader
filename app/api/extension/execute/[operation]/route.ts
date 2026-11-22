import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { authenticateExtension, ExtensionAuthError } from "@/lib/browserExtension";
import { withExtensionUser } from "@/lib/extensionIdentity";
import { POST as explain } from "@/app/api/explain-word/route";
import { POST as stream } from "@/app/api/explain-word-stream/route";
import { POST as dictionary } from "@/app/api/dictionary/route";
import { POST as ask } from "@/app/api/ask-sentence/route";
import { POST as pronunciation } from "@/app/api/pronunciation/route";
import { POST as translate } from "@/app/api/translate-article/route";
import { extensionSelectionMode, extensionTranslationInput } from "@/lib/browserExtensionSelection";
import { reconcileStudyCards } from "@/lib/studyStore";
import { saveSelectedSentence, SavedSentenceWriteError } from "@/lib/savedSentencesServer";
import { LATIN_PHRASE_PATTERN } from "@/lib/latinWords";
import { accountFetch, writeSyncObjects } from "@/lib/accountStore";
import { createStandaloneVocabularyEntry } from "@/lib/standaloneDictionary";
import { normalizeAnkiInfo } from "@/lib/ankiData";
import { readJsonBody } from "@/lib/limitedBody";
import type { WordExplanation, ExplanationRequest } from "@/types/reader";
import type { DictionaryResult } from "@/types/dictionary";
import type { VocabularyEntry } from "@/types/vocabulary";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function saveVocabulary(request: Request, userId: string) {
  const body = await readJsonBody<{ context: ExplanationRequest; explanation?: WordExplanation; dictionary?: DictionaryResult }>(request, 48 * 1024);
  const ctx = body?.context;
  if (!ctx || typeof ctx.word !== "string" || !LATIN_PHRASE_PATTERN.test(ctx.word)
    || ![ctx.sentence, ctx.previousSentence, ctx.nextSentence].every(v => typeof v === "string" && v.length <= 5000)) return json({ error: "保存的词和语境无效。" }, 400);
  let entry: VocabularyEntry;
  if (body.dictionary) {
    if (body.dictionary.query !== ctx.word || !Array.isArray(body.dictionary.senses) || !body.dictionary.senses.length) return json({ error: "请等待词典结果完成后保存。" }, 400);
    entry = createStandaloneVocabularyEntry(body.dictionary);
  } else {
    const e = body.explanation;
    if (!e || typeof e.word !== "string" || e.word.toLowerCase() !== ctx.word.toLowerCase() || ![e.basicMeaning, e.contextMeaning, e.phonetic, e.usageNote, e.sentenceTranslation].every(v => typeof v === "string")) return json({ error: "请等待解释完成后保存。" }, 400);
    const now = new Date().toISOString();
    entry = { ...e, id: "", sourceSentence: ctx.sentence, previousSentence: ctx.previousSentence, nextSentence: ctx.nextSentence,
      createdAt: now, updatedAt: now, anki: normalizeAnkiInfo(e, ctx.sentence) };
  }
  const params = new URLSearchParams({ user_id: `eq.${userId}`, kind: "eq.vocabulary", "payload->>word": `ilike.${ctx.word}`,
    "payload->>sourceSentence": `eq.${entry.sourceSentence}`, deleted_at: "is.null", select: "object_key,payload,server_version", limit: "1" });
  const rows = await accountFetch<Array<{ object_key: string; payload: VocabularyEntry; server_version: number }>>(`user_data_objects?${params}`);
  const previous = rows[0];
  const id = previous?.object_key || `extension-${createHash("sha256").update(`${ctx.word.toLowerCase()}\n${entry.sourceSentence}`).digest("hex").slice(0, 32)}`;
  entry = { ...entry, id, anki: { ...entry.anki, ankiNoteId: previous?.payload.anki?.ankiNoteId ?? null, ankiImportedAt: previous?.payload.anki?.ankiImportedAt ?? null }, ...(previous ? { createdAt: previous.payload.createdAt } : {}) };
  const result = await writeSyncObjects(userId, [{ kind: "vocabulary", objectKey: id, payload: entry, clientUpdatedAt: entry.updatedAt, serverVersion: previous?.server_version || 0 }]);
  if (!result[0]?.accepted) return json({ error: "生词已在其他窗口更新，请重试保存。" }, 409);
  return json({ saved: true, id });
}
export async function POST(request: Request, args: { params: Promise<{ operation: string }> }) {
  try {
    const { operation } = await args.params;
    const auth = await authenticateExtension(request);
    return await withExtensionUser(auth.user, async () => {
      switch (operation) {
        case "explain": return explain(request);
        case "stream": return stream(request);
        case "dictionary": return dictionary(request);
        case "ask": return ask(request);
        case "pronunciation": return pronunciation(request);
        case "translate": {
          const input = extensionTranslationInput(await readJsonBody(request, 48 * 1024));
          if (!input) return json({ error: "请选择至少 4 个英文词，且不超过 5000 字符。" }, 400);
          const headers = new Headers(request.headers);
          headers.delete("x-context-translation-action-id"); headers.delete("content-length"); headers.set("Accept", "application/json");
          const url = new URL(request.url); url.search = "";
          return translate(new Request(url, { method: "POST", headers, body: JSON.stringify(input), signal: request.signal }));
        }
        case "save-sentence": {
          const body = await readJsonBody<{ original?: string; translation?: string }>(request, 128 * 1024);
          if (typeof body?.original !== "string" || extensionSelectionMode(body.original) !== "translation" ||
              typeof body.translation !== "string" || !body.translation.trim() || body.translation.length > 24000) {
            return json({ error: "请等待所选句子的译文完成后再收藏。" }, 400);
          }
          const entry = await saveSelectedSentence(auth.user.id, body.original.trim(), body.translation.trim());
          await reconcileStudyCards(auth.user.id, entry);
          return json({ saved: true, id: entry.id });
        }
        case "save": return saveVocabulary(request, auth.user.id);
        case "account": return json({ id: auth.user.id, nickname: auth.nickname, connectionId: auth.connection.id });
        case "disconnect": {
          await accountFetch(`browser_extension_connections?id=eq.${auth.connection.id}&user_id=eq.${auth.user.id}`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
          return json({ ok: true });
        }
        default: return json({ error: "扩展操作不支持。" }, 404);
      }
    });
  } catch (error) {
    if (error instanceof SavedSentenceWriteError) return json({ error: error.message }, error.status);
    if (error instanceof ExtensionAuthError) return json({ error: error.message }, 401);
    console.error("Browser extension request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "扩展服务暂时不可用，请稍后重试。" }, 503);
  }
}
