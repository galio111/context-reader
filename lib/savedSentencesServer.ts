import "server-only";
import { createHash } from "node:crypto";
import { accountFetch, writeSyncObjects } from "./accountStore";
import { normalizeAnkiInfo } from "./ankiData";
import type { VocabularyEntry } from "@/types/vocabulary";

export class SavedSentenceWriteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type SentenceRow = { payload: VocabularyEntry; server_version: number; deleted_at: string | null };

async function updateSentence(owner: string, id: string, change: (previous: VocabularyEntry | null) => VocabularyEntry) {
  const params = new URLSearchParams({ user_id: `eq.${owner}`, kind: "eq.vocabulary", object_key: `eq.${id}`,
    select: "payload,server_version,deleted_at", limit: "1" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await accountFetch<SentenceRow[]>(`user_data_objects?${params}`);
    const previous = row && !row.deleted_at ? row.payload : null;
    if (previous && previous.entryKind !== "sentence") throw new SavedSentenceWriteError("收藏记录已改变，请刷新后重试。", 409);
    const next = change(previous);
    if (next === previous) return next;
    const [result] = await writeSyncObjects(owner, [{ kind: "vocabulary", objectKey: id, payload: next,
      clientUpdatedAt: next.updatedAt, serverVersion: row?.server_version ?? 0 }]);
    if (result?.accepted) return next;
  }
  throw new SavedSentenceWriteError("好句刚在其他窗口更新，请重试。", 409);
}

export function saveSelectedSentence(owner: string, original: string, translation: string) {
  const id = "sentence-" + createHash("sha256").update(original.normalize("NFC")).digest("hex");
  return updateSentence(owner, id, previous => {
    if (previous?.sentenceStudyEnabled && previous.sentenceTranslation === translation) return previous;
    const now = new Date().toISOString();
    return {
      entryKind: "sentence", id, word: original, sourceSentence: original, sentenceTranslation: translation,
      sentenceStudyEnabled: true,
      lemma: "", phonetic: "", partOfSpeech: "", basicMeaning: "", contextMeaning: "",
      usageNote: "", collocation: "", exampleEnglish: "", exampleChinese: "", previousSentence: "", nextSentence: "",
      difficulty: "medium", shouldAddToVocabulary: true, createdAt: previous?.createdAt || now, updatedAt: now,
      anki: normalizeAnkiInfo({ word: original, basicMeaning: translation }),
    };
  });
}

export function setSentenceStudyEnabled(owner: string, id: string, enabled: boolean) {
  if (!enabled) throw new SavedSentenceWriteError("收藏的好句会自动加入背诵，请刷新页面。", 409);
  return updateSentence(owner, id, previous => {
    if (!previous) throw new SavedSentenceWriteError("这条好句已移除，请刷新生词本。", 404);
    return previous.sentenceStudyEnabled === enabled ? previous :
      { ...previous, sentenceStudyEnabled: enabled, updatedAt: new Date().toISOString() };
  });
}
