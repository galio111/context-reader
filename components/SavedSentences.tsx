"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAccount } from "./AccountProvider";
import { orderStudyVocabulary } from "@/lib/studyVocabularyOrder";
import type { VocabularyEntry } from "@/types/vocabulary";
import styles from "./SavedSentences.module.css";

export type NotebookSection = "words" | "sentences";

export function NotebookSections({ value, onChange }: { value: NotebookSection; onChange(value: NotebookSection): void }) {
  return <div className={styles.sections} role="group" aria-label="生词本板块">
    {([["words", "生词"], ["sentences", "好句"]] as const).map(([key, label]) =>
      <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}
  </div>;
}

function SentenceRow({ entry, onDelete, onStudyChange }: SentenceListActions & { entry: VocabularyEntry }) {
  const { account, syncNow } = useAccount();
  const [lastSave, setLastSave] = useState<VocabularyEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const current = lastSave && lastSave.updatedAt >= entry.updatedAt ? lastSave : entry;

  async function toggleStudy() {
    const owner = account.profile?.userId;
    if (pending || !owner) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/study", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Context-Account": owner },
        body: JSON.stringify({ op: "sentence_study", id: entry.id, enabled: !current.sentenceStudyEnabled }) });
      const data = await response.json();
      if (!response.ok || data.entry?.id !== entry.id) throw new Error(data.error || "背诵设置更新失败，请重试。");
      setLastSave(data.entry);
      onStudyChange?.();
      void syncNow({ dirtyKinds: ["vocabulary"] }).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "背诵设置更新失败，请重试。");
    } finally { setPending(false); }
  }

  return <article className={styles.row}>
    <p lang="en">{entry.sourceSentence}</p><p lang="zh-CN">{entry.sentenceTranslation}</p>
    <div className={styles.actions}>
      <button type="button" disabled={pending || !account.profile?.userId} aria-pressed={Boolean(current.sentenceStudyEnabled)}
        title={current.sentenceStudyEnabled ? "从背诵队列移除" : "加入网站背诵队列"} onClick={toggleStudy}>
        {pending ? "正在保存…" : current.sentenceStudyEnabled ? "已加入背诵" : "加入背诵"}
      </button>
      {onDelete && <button type="button" onClick={() => onDelete(entry.id)}>删除好句</button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </article>;
}

type SentenceListActions = { onDelete?(id: string): void; onStudyChange?(): void };

export function SavedSentences({ entries, ...actions }: SentenceListActions & { entries: VocabularyEntry[] }) {
  const [query, setQuery] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const saved = useMemo(() => orderStudyVocabulary(entries.filter(e => e.entryKind === "sentence"), "collected"), [entries]);
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return saved.filter(e => e.sourceSentence.toLocaleLowerCase().includes(search) || e.sentenceTranslation.includes(search));
  }, [saved, query]);
  const virtual = matches.length > 60;
  const rows = useVirtualizer({ count: virtual ? matches.length : 0, getScrollElement: () => scroll.current,
    getItemKey: index => matches[index].id, estimateSize: () => 160, overscan: 4 });
  return <div className={styles.collection}>
    {saved.length > 0 && <input className={styles.search} type="search" aria-label="搜索好句" placeholder="搜索原文或中文译文" value={query}
      onChange={event => { setQuery(event.target.value); if (scroll.current) scroll.current.scrollTop = 0; }}/>}
    <div ref={scroll} className={styles.list}>
      {!matches.length && <p className={styles.empty}>{saved.length ? "没有匹配的好句。" : "还没有好句。在网页里划选句子，翻译后点「收藏到好句」。"}</p>}
      {virtual ? <div style={{ height: rows.getTotalSize(), position: "relative" }}>{rows.getVirtualItems().map(row =>
        <div key={row.key} data-index={row.index} ref={rows.measureElement} style={{position:"absolute",top:0,width:"100%",transform:`translateY(${row.start}px)`}}>
          <SentenceRow entry={matches[row.index]} {...actions}/>
        </div>)}</div> : matches.map(entry => <SentenceRow key={entry.id} entry={entry} {...actions}/>)}
    </div>
  </div>;
}
