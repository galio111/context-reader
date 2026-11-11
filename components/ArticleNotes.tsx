"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { ARTICLE_NOTE_MAX_LENGTH, readArticleNotes, saveArticleNote, type ArticleNote } from "@/lib/articleNotes";
import { getLearningStorage, LEARNING_STORAGE_EVENT } from "@/lib/learningStorage";
import styles from "./ReaderToolbar.module.css";

export function ArticleNotes({ owner, articleKey, priorIds, resolveArticleKey }: {
  owner: string | null;
  articleKey?: string;
  priorIds?: string[];
  resolveArticleKey: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<ArticleNote[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const retry = useRef<ArticleNote>(null);
  const pending = useRef(false);
  const priorKeys = JSON.stringify(priorIds ?? []);

  useEffect(() => {
    const keys = new Set([articleKey, ...(JSON.parse(priorKeys) as string[]).map(id => "article:" + id)]);
    const refresh = () => setNotes(owner ? readArticleNotes(getLearningStorage(), owner)
      .filter(note => keys.has(note.articleKey))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : []);
    refresh();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh);
    window.addEventListener(LEARNING_STORAGE_EVENT, refresh);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refresh);
      window.removeEventListener(LEARNING_STORAGE_EVENT, refresh);
    };
  }, [articleKey, owner, priorKeys]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending.current) return;
    pending.current = true;
    setSaving(true);
    setStatus("");
    try {
      const key = await resolveArticleKey();
      if (!owner || !key) return;
      const note = retry.current?.text === text && retry.current.articleKey === key ? retry.current : {
        id: crypto.randomUUID(), articleKey: key, text, createdAt: new Date().toISOString(),
      };
      retry.current = note;
      await saveArticleNote(owner, note);
      retry.current = null;
      setNotes(items => [note, ...items.filter(item => item.id !== note.id)]);
      setDraft("");
      setStatus("已保存");
    } catch {
      setStatus("记录未能保存，请重试。");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <section className={styles.articleNotes} aria-label="本篇记录">
    <form onSubmit={submit}>
      <textarea aria-label="本篇记录" placeholder="记下这篇文章的想法…" rows={3}
        value={draft} maxLength={ARTICLE_NOTE_MAX_LENGTH} disabled={saving}
        onChange={event => { setDraft(event.target.value); setStatus(""); }} />
      <div className={styles.articleNoteActions}>
        <button type="submit" disabled={saving || !draft.trim()}>{saving ? "保存中" : "保存记录"}</button>
        <span role="status">{status}</span>
      </div>
    </form>
    {notes.length > 0 && <ul aria-label="已保存记录">{notes.map(note => <li key={note.id}>{note.text}</li>)}</ul>}
  </section>;
}
