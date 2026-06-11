"use client";

import { useState } from "react";
import { AnkiPreviewModal } from "@/components/AnkiPreviewModal";
import type { VocabularyEntry } from "@/types/vocabulary";

interface VocabularyPanelProps {
  entries: VocabularyEntry[];
  open: boolean;
  importingId: string;
  importError: string;
  placement?: "drawer" | "dialog";
  showAnkiActions?: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
  onCopy: (entry: VocabularyEntry) => void;
  onImportAnki: (entry: VocabularyEntry) => void;
  onImportAllAnki: () => void;
}

export function VocabularyPanel({
  entries,
  open,
  importingId,
  importError,
  placement = "drawer",
  showAnkiActions = true,
  onClose,
  onDelete,
  onClear,
  onExportCsv,
  onCopy,
  onImportAnki,
  onImportAllAnki,
}: VocabularyPanelProps) {
  const [previewEntry, setPreviewEntry] = useState<VocabularyEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  if (!open) {
    return null;
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = normalizedSearchQuery
    ? entries.filter((entry) => entry.word.trim().toLowerCase().startsWith(normalizedSearchQuery))
    : entries;
  const unimportedCount = entries.filter((entry) => !entry.anki.ankiNoteId).length;
  const importingAll = importingId === "__all__";
  const panelClassName =
    placement === "dialog"
      ? "mx-auto mt-8 flex max-h-[calc(100dvh-4rem)] w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_22px_60px_rgba(15,23,42,0.22)] sm:mt-10"
      : "ml-auto flex h-full w-full max-w-3xl flex-col bg-white";

  return (
    <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm">
      <div className={panelClassName}>
        <header className="flex items-center justify-between border-b border-[#e0e0e0] px-5 py-4">
          <div>
            <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">生词本</h2>
            <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">{entries.length} 个词条</p>
          </div>
          <button
            type="button"
            className="h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="grid gap-3 border-b border-[#e0e0e0] px-5 py-3">
          <label className="block">
            <span className="sr-only">检索生词</span>
            <input
              type="search"
              className="h-11 w-full rounded-full border border-black/10 px-5 text-[17px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="输入单词前缀检索生词"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
              onClick={onExportCsv}
              disabled={entries.length === 0}
            >
              导出 CSV
            </button>
            {showAnkiActions && (
              <button
                type="button"
                className="hidden h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:border-[#d2d2d7] disabled:text-[#7a7a7a] lg:inline-flex lg:items-center"
                onClick={onImportAllAnki}
                disabled={unimportedCount === 0 || Boolean(importingId)}
              >
                {importingAll ? "批量导入中" : `导入未导入 (${unimportedCount})`}
              </button>
            )}
            <button
              type="button"
              className="h-10 rounded-full border border-[#e0e0e0] px-4 text-sm tracking-[-0.224px] text-[#333333] transition active:scale-95 disabled:text-[#7a7a7a]"
              onClick={onClear}
              disabled={entries.length === 0 || importingAll}
            >
              清空生词本
            </button>
          </div>
        </div>

        {importError && (
          <div className="mx-5 mt-4 rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {importError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <p className="text-sm tracking-[-0.224px] text-[#7a7a7a]">还没有加入生词。</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-sm tracking-[-0.224px] text-[#7a7a7a]">没有匹配的生词。</p>
          ) : (
            <ul className="space-y-3">
              {filteredEntries.map((entry) => {
                const imported = Boolean(entry.anki.ankiNoteId);
                return (
                  <li key={entry.id} className="rounded-[18px] border border-[#e0e0e0] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">{entry.word}</h3>
                        <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                          {entry.lemma} · {entry.partOfSpeech}
                          {entry.phonetic ? ` · ${entry.phonetic}` : ""}
                        </p>
                      </div>
                      {showAnkiActions && (
                        <span
                          className={`hidden rounded-full px-3 py-1 text-xs font-medium lg:inline-flex ${
                            imported
                              ? "bg-[#f5f5f7] text-[#0066cc]"
                              : "bg-[#f5f5f7] text-[#333333]"
                          }`}
                        >
                          {imported ? "已导入 Anki" : "未导入"}
                        </span>
                      )}
                    </div>

                    <dl className="mt-3 grid gap-3 text-sm leading-6 tracking-[-0.224px] text-[#333333]">
                      <div>
                        <dt className="font-semibold text-[#1d1d1f]">当前语境含义</dt>
                        <dd>{entry.contextMeaning}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-[#1d1d1f]">基础释义</dt>
                        {entry.phonetic && <dd className="text-[#7a7a7a]">音标：{entry.phonetic}</dd>}
                        <dd>{entry.basicMeaning}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-[#1d1d1f]">原句</dt>
                        <dd>{entry.sourceSentence}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-[#1d1d1f]">自然翻译</dt>
                        <dd>{entry.sentenceTranslation}</dd>
                      </div>
                    </dl>

                    {showAnkiActions && entry.anki.cardMode === "basic_cn_to_en" && (
                      <p className="mt-3 hidden rounded-[18px] bg-[#f5f5f7] px-3 py-2 text-sm tracking-[-0.224px] text-[#333333] lg:block">
                        当前句子不适合语境挖空，导入时将使用“基础释义中译英卡”。
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {showAnkiActions && (
                        <>
                          <button
                            type="button"
                            className="hidden h-9 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95 lg:inline-flex lg:items-center"
                            onClick={() => setPreviewEntry(entry)}
                          >
                            预览 Anki 卡片
                          </button>
                          <button
                            type="button"
                            className="hidden h-9 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7] lg:inline-flex lg:items-center"
                            onClick={() => onImportAnki(entry)}
                            disabled={imported || Boolean(importingId)}
                          >
                            {imported ? "已导入 Anki" : importingId === entry.id ? "导入中" : importingAll ? "批量导入中" : "导入 Anki"}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="h-9 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
                        onClick={() => onCopy(entry)}
                      >
                        复制解释
                      </button>
                      <button
                        type="button"
                        className="h-9 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
                        onClick={onExportCsv}
                      >
                        导出 CSV
                      </button>
                      <button
                        type="button"
                        className="h-9 rounded-full border border-[#e0e0e0] px-4 text-sm tracking-[-0.224px] text-[#333333] transition active:scale-95"
                        onClick={() => onDelete(entry.id)}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {showAnkiActions && (
        <div className="hidden lg:block">
          <AnkiPreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />
        </div>
      )}
    </div>
  );
}
