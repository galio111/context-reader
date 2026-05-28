"use client";

import { useState } from "react";
import { AnkiPreviewModal } from "@/components/AnkiPreviewModal";
import type { VocabularyEntry } from "@/types/vocabulary";

interface VocabularyPanelProps {
  entries: VocabularyEntry[];
  open: boolean;
  importingId: string;
  importError: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
  onCopy: (entry: VocabularyEntry) => void;
  onImportAnki: (entry: VocabularyEntry) => void;
}

function cardModeLabel(entry: VocabularyEntry): string {
  return entry.anki.cardMode === "cloze_context" ? "语境挖空卡" : "基础释义中译英卡";
}

export function VocabularyPanel({
  entries,
  open,
  importingId,
  importError,
  onClose,
  onDelete,
  onClear,
  onExportCsv,
  onCopy,
  onImportAnki,
}: VocabularyPanelProps) {
  const [previewEntry, setPreviewEntry] = useState<VocabularyEntry | null>(null);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-950/25">
      <div className="ml-auto flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-950">生词本</h2>
            <p className="mt-1 text-sm text-gray-500">{entries.length} 个词条</p>
          </div>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-gray-200 px-5 py-3">
          <button
            type="button"
            className="rounded-md bg-gray-950 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            onClick={onExportCsv}
            disabled={entries.length === 0}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-300"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            清空生词本
          </button>
        </div>

        {importError && (
          <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {importError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-500">还没有加入生词。</p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => {
                const imported = Boolean(entry.anki.ankiNoteId);
                return (
                  <li key={entry.id} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-950">{entry.word}</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          {entry.lemma} · {entry.partOfSpeech}
                          {entry.phonetic ? ` · ${entry.phonetic}` : ""}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          imported
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {imported ? "已导入 Anki" : "未导入"}
                      </span>
                    </div>

                    <dl className="mt-3 grid gap-3 text-sm leading-6 text-gray-700">
                      <div>
                        <dt className="font-semibold text-gray-900">当前语境含义</dt>
                        <dd>{entry.contextMeaning}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-900">基础释义</dt>
                        {entry.phonetic && <dd className="text-gray-500">音标：{entry.phonetic}</dd>}
                        <dd>{entry.basicMeaning}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-900">原句</dt>
                        <dd>{entry.sourceSentence}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-900">自然翻译</dt>
                        <dd>{entry.sentenceTranslation}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-900">制卡模式</dt>
                        <dd>{cardModeLabel(entry)}</dd>
                      </div>
                    </dl>

                    {entry.anki.cardMode === "basic_cn_to_en" && (
                      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        当前句子不适合语境挖空，导入时将使用“基础释义中译英卡”。
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setPreviewEntry(entry)}
                      >
                        预览 Anki 卡片
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-gray-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                        onClick={() => onImportAnki(entry)}
                        disabled={imported || importingId === entry.id}
                      >
                        {imported ? "已导入 Anki" : importingId === entry.id ? "导入中" : "导入 Anki"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => onCopy(entry)}
                      >
                        复制解释
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={onExportCsv}
                      >
                        导出 CSV
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
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

      <AnkiPreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />
    </div>
  );
}
