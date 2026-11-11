import type { AccountSyncObject } from "@/types/account";
import { getLearningStorage, isLearningStorage, flushLearningStorage } from "./learningStorage";
import { notifyAccountDataChanged } from "./accountEvents";

export const ARTICLE_NOTES_KEY = "context-reader:article-notes:v1";
export const ARTICLE_NOTE_PREFIX = "article-note:v1:";
export const ARTICLE_NOTE_MAX_LENGTH = 4000;
const OWNER_KEY = "context-reader:local-account-owner:v1";

export interface ArticleNote {
  id: string;
  articleKey: string;
  text: string;
  createdAt: string;
}

export function articleNoteObjectKey(note: ArticleNote): string {
  return ARTICLE_NOTE_PREFIX + note.id;
}

function normalizeArticleNote(value: unknown): ArticleNote | null {
  const note = value as Partial<ArticleNote> | null;
  if (typeof note?.id !== "string" || !/^[a-f0-9-]{36}$/.test(note.id)
    || typeof note.articleKey !== "string" || !/^(document:[a-f0-9]{64}|article:.{1,180})$/.test(note.articleKey)
    || typeof note.text !== "string" || !note.text.trim() || note.text.length > ARTICLE_NOTE_MAX_LENGTH
    || typeof note.createdAt !== "string" || note.createdAt.length !== 24 || !Number.isFinite(Date.parse(note.createdAt))) return null;
  return { id: note.id, articleKey: note.articleKey, text: note.text, createdAt: note.createdAt };
}

export function readArticleNotes(storage: Storage, owner: string): ArticleNote[] {
  if (!owner || storage.getItem(OWNER_KEY) !== owner) return [];
  let rows: unknown[];
  if (isLearningStorage(storage)) rows = storage.getRecords(ARTICLE_NOTES_KEY);
  else {
    try { rows = Object.values(JSON.parse(storage.getItem(ARTICLE_NOTES_KEY) || "{}")); }
    catch { return []; }
  }
  return rows.map(normalizeArticleNote).filter((note): note is ArticleNote => Boolean(note));
}

function writeArticleNotes(storage: Storage, owner: string, notes: ArticleNote[], deletedIds: string[] = []) {
  if (!owner || storage.getItem(OWNER_KEY) !== owner) throw new Error("账号已切换");
  if (isLearningStorage(storage)) {
    storage.updateRecords(ARTICLE_NOTES_KEY, notes.map(note => [note.id, note]), deletedIds);
  } else {
    const current = new Map(readArticleNotes(storage, owner).map(note => [note.id, note]));
    for (const id of deletedIds) current.delete(id);
    for (const note of notes) current.set(note.id, note);
    storage.setItem(ARTICLE_NOTES_KEY, JSON.stringify(Object.fromEntries(current)));
  }
}

export async function saveArticleNote(owner: string, note: ArticleNote): Promise<void> {
  const normalized = normalizeArticleNote(note);
  if (!normalized) throw new Error("记录格式不正确");
  writeArticleNotes(getLearningStorage(), owner, [normalized]);
  await flushLearningStorage();
  if (getLearningStorage().getItem(OWNER_KEY) === owner) notifyAccountDataChanged(["preferences"]);
}

export function mergeArticleNoteObjects(storage: Storage, owner: string, objects: AccountSyncObject[]): void {
  if (!owner) return;
  const notes: ArticleNote[] = [];
  const deletedIds: string[] = [];
  for (const object of objects) {
    if (object.kind !== "preferences" || !object.objectKey.startsWith(ARTICLE_NOTE_PREFIX)) continue;
    if (object.deletedAt) {
      deletedIds.push(object.objectKey.slice(ARTICLE_NOTE_PREFIX.length));
    } else {
      const note = normalizeArticleNote(object.payload);
      if (note && articleNoteObjectKey(note) === object.objectKey) notes.push(note);
    }
  }
  if (notes.length || deletedIds.length) writeArticleNotes(storage, owner, notes, deletedIds);
}
