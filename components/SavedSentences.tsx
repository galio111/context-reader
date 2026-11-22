"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

type SentenceListActions = { onDelete?(id: string): void };

function SentenceRow({ entry, onDelete }: SentenceListActions & { entry: VocabularyEntry }) {
  return <article className={styles.row}>
    <p lang="en">{entry.sourceSentence}</p><p lang="zh-CN">{entry.sentenceTranslation}</p>
    {onDelete && <div className={styles.actions}><button type="button" onClick={() => onDelete(entry.id)}>删除好句</button></div>}
  </article>;
}

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
    <div ref={scroll} className={styles.list} data-local-scroll-surface>
      {!matches.length && <p className={styles.empty}>{saved.length ? "没有匹配的好句。" : "还没有好句。在网页里划选句子，翻译后点「收藏到好句」。"}</p>}
      {virtual ? <div style={{ height: rows.getTotalSize(), position: "relative" }}>{rows.getVirtualItems().map(row =>
        <div key={row.key} data-index={row.index} ref={rows.measureElement} style={{position:"absolute",top:0,width:"100%",transform:`translateY(${row.start}px)`}}>
          <SentenceRow entry={matches[row.index]} {...actions}/>
        </div>)}</div> : matches.map(entry => <SentenceRow key={entry.id} entry={entry} {...actions}/>)}
    </div>
  </div>;
}
