"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnkiPreviewModal } from "@/components/AnkiPreviewModal";
import ClearableField from "@/components/ClearableField";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { VocabularyLearningDetails } from "@/components/VocabularyLearningDetails";
import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import { currentFormPhonetic } from "@/lib/pronunciation";
import { sortVocabularyEntriesByCreatedAt } from "@/lib/vocabularyMerge";
import { createVocabularySearchIndex, searchVocabularyIndex } from "@/lib/vocabularySearch";
import { hasStandaloneVocabularyDetails } from "@/lib/vocabularyPresentation";
import type { VocabularyEntry } from "@/types/vocabulary";

const VOCABULARY_ROW_GAP = 12;
const VOCABULARY_OVERSCAN = 2;
const keepScrollOffsetStable = () => false;

function wrappedLineCount(value: string, charactersPerLine: number): number {
  return Math.max(1, Math.ceil(value.trim().length / charactersPerLine));
}

function estimatedVocabularyRowHeight(
  entry: VocabularyEntry,
  expanded: boolean,
  showAnkiActions: boolean,
): number {
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const proseWidth = narrow ? 28 : 72;
  const translationWidth = narrow ? 24 : 48;
  const isStandalone = !entry.sourceSentence.trim();
  const baseLines = isStandalone
    ? wrappedLineCount(entry.basicMeaning, proseWidth)
    : wrappedLineCount(entry.contextMeaning, proseWidth)
      + wrappedLineCount(entry.basicMeaning, proseWidth)
      + wrappedLineCount(entry.sourceSentence, proseWidth)
      + wrappedLineCount(entry.sentenceTranslation, translationWidth);
  const extraBaseLines = Math.max(0, baseLines - (isStandalone ? 1 : 4));
  const hasExtendedDetails = Boolean(
    entry.usageNote || entry.collocation || entry.exampleEnglish || entry.exampleChinese,
  );
  let height = (isStandalone ? 250 : 350) + extraBaseLines * 24;
  if (narrow) height += 34;
  if (hasExtendedDetails) height += 32;
  if (showAnkiActions && entry.anki.cardMode === "basic_cn_to_en") height += 64;
  if (!expanded) return height;

  const extendedValues = [
    entry.usageNote,
    entry.collocation,
    entry.exampleEnglish,
    entry.exampleChinese,
  ].filter(Boolean);
  const extendedLines = extendedValues.reduce(
    (total, value) => total + wrappedLineCount(value, narrow ? 26 : 66),
    0,
  );
  return height + extendedValues.length * 36 + extendedLines * 24;
}

function selectedTextKind(value: string): "word" | "phrase" {
  return value.trim().split(/\s+/).filter(Boolean).length > 1 ? "phrase" : "word";
}

function meaningLabel(value: string): string {
  return selectedTextKind(value) === "phrase" ? "所选短语在本句中的含义" : "所选词在本句中的含义";
}

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
  onJumpToSource?: (entry: VocabularyEntry) => void;
  canJumpToSource?: (entry: VocabularyEntry) => boolean;
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
  onJumpToSource,
  canJumpToSource,
  onImportAnki,
  onImportAllAnki,
}: VocabularyPanelProps) {
  const [previewEntry, setPreviewEntry] = useState<VocabularyEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const sourceJumpAvailabilityRef = useRef<{
    entries: VocabularyEntry[];
    canJumpToSource: VocabularyPanelProps["canJumpToSource"];
    results: Map<string, boolean>;
  }>({
    entries,
    canJumpToSource,
    results: new Map(),
  });

  if (
    sourceJumpAvailabilityRef.current.entries !== entries ||
    sourceJumpAvailabilityRef.current.canJumpToSource !== canJumpToSource
  ) {
    sourceJumpAvailabilityRef.current = {
      entries,
      canJumpToSource,
      results: new Map(),
    };
  }

  const canJumpToEntrySource = useCallback((entry: VocabularyEntry) => {
    if (!canJumpToSource) {
      return true;
    }
    const cached = sourceJumpAvailabilityRef.current.results.get(entry.id);
    if (cached !== undefined) {
      return cached;
    }
    const available = canJumpToSource(entry);
    sourceJumpAvailabilityRef.current.results.set(entry.id, available);
    return available;
  }, [canJumpToSource]);

  useEffect(() => {
    if (!open) {
      setPreviewEntry(null);
      setSearchQuery("");
      setExpandedEntryIds(new Set());
      return;
    }

    setPreviewEntry(null);
    setSearchQuery("");
    window.requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: 0, left: 0 });
    });
  }, [open]);

  const orderedEntries = useMemo(() => sortVocabularyEntriesByCreatedAt(entries), [entries]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const vocabularySearchIndex = useMemo(
    () => createVocabularySearchIndex(orderedEntries),
    [orderedEntries],
  );
  const filteredEntries = useMemo(
    () => searchVocabularyIndex(vocabularySearchIndex, deferredSearchQuery),
    [deferredSearchQuery, vocabularySearchIndex],
  );
  const getVocabularyEntryKey = useCallback(
    (index: number) => filteredEntries[index]?.id ?? index,
    [filteredEntries],
  );
  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => {
      const entry = filteredEntries[index];
      return entry
        ? estimatedVocabularyRowHeight(entry, expandedEntryIds.has(entry.id), showAnkiActions)
        : 400;
    },
    getItemKey: getVocabularyEntryKey,
    gap: VOCABULARY_ROW_GAP,
    overscan: VOCABULARY_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = keepScrollOffsetStable;
  const unimportedCount = useMemo(
    () => entries.filter((entry) => !entry.anki.ankiNoteId).length,
    [entries],
  );
  const importingAll = importingId === "__all__";
  const reconcilingAnki = importingId === "__reconcile__";
  const panelClassName =
    placement === "dialog"
      ? "cr-reader-panel cr-vocabulary-panel mx-auto mt-8 flex h-[calc(100dvh-4rem)] min-h-0 w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_22px_60px_rgba(15,23,42,0.22)] sm:mt-10"
      : "cr-reader-panel cr-vocabulary-panel ml-auto flex h-full min-h-0 w-full max-w-3xl flex-col bg-white";

  useEffect(() => {
    if (open) {
      rowVirtualizer.scrollToOffset(0);
    }
  }, [deferredSearchQuery, filteredEntries.length, open, rowVirtualizer]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const body = document.body;
    const documentElement = document.documentElement;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };
    const previousDocumentOverflow = documentElement.style.overflow;

    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      documentElement.style.overflow = previousDocumentOverflow;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.paddingRight = previousBodyStyles.paddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-black/25"
      data-local-scroll-surface
    >
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
            <ClearableField value={searchQuery} onClear={() => setSearchQuery("")} label="清空生词检索">
              <input
                type="search"
                className="h-11 w-full rounded-full border border-black/10 px-5 text-[17px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="输入单词前缀检索生词"
              />
            </ClearableField>
          </label>
          <details className="group lg:hidden">
            <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-full border border-[#d2d2d7] px-4 text-sm font-medium text-[#333333] marker:content-none">
              更多操作
              <span aria-hidden="true" className="text-lg leading-none transition-transform group-open:rotate-45">＋</span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-[12px] bg-[#f5f7f8] p-2">
              <button
                type="button"
                className="h-11 rounded-full bg-[#0066cc] px-4 text-sm text-white active:scale-95 disabled:bg-[#d2d2d7]"
                onClick={onExportCsv}
                disabled={entries.length === 0}
              >
                导出 CSV
              </button>
              <button
                type="button"
                className="h-11 rounded-full border border-[#d2d2d7] bg-white px-4 text-sm text-[#333333] active:scale-95 disabled:text-[#7a7a7a]"
                onClick={onClear}
                disabled={entries.length === 0 || importingAll}
              >
                清空生词本
              </button>
            </div>
          </details>
          <div className="hidden flex-wrap gap-2 lg:flex">
            <button
              type="button"
              className="h-10 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
              onClick={onExportCsv}
              disabled={entries.length === 0}
            >
              导出
            </button>
            {showAnkiActions && (
              <button
                type="button"
                className="hidden h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:border-[#d2d2d7] disabled:text-[#7a7a7a] lg:inline-flex lg:items-center"
                onClick={onImportAllAnki}
                disabled={unimportedCount === 0 || Boolean(importingId)}
              >
                {importingAll
                  ? "批量导入中"
                  : reconcilingAnki
                    ? "正在核对 Anki…"
                    : `导入未导入 (${unimportedCount})`}
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

        <div
          ref={listRef}
          className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-5 py-4 [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
        >
          {entries.length === 0 ? (
            <p className="text-sm tracking-[-0.224px] text-[#7a7a7a]">还没有加入生词。</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-sm tracking-[-0.224px] text-[#7a7a7a]">没有匹配的生词。</p>
          ) : (
            <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filteredEntries[virtualRow.index];
                if (!entry) {
                  return null;
                }
                const imported = Boolean(entry.anki.ankiNoteId);
                const isStandalone = !entry.sourceSentence.trim();
                const isStandaloneChineseToEnglish =
                  entry.anki.cardMode === "basic_cn_to_en_dictionary";
                const sourceJumpEnabled = onJumpToSource && canJumpToEntrySource(entry);
                const isExpanded = expandedEntryIds.has(entry.id);
                const entryPhonetic = currentFormPhonetic(entry);
                const hasExtendedDetails = isStandalone
                  ? hasStandaloneVocabularyDetails(entry)
                  : Boolean(entry.usageNote || entry.collocation || entry.exampleEnglish || entry.exampleChinese);
                return (
                  <article
                    key={entry.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute inset-x-0 top-0 rounded-[18px] border border-[#e0e0e0] p-4 [contain:layout_paint]"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">{entry.word}</h3>
                          {onJumpToSource && !isStandalone && (
                            <button
                              type="button"
                              className="h-8 shrink-0 rounded-full border border-[#0066cc] px-3 text-xs tracking-[-0.12px] text-[#0066cc] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#86868b]"
                              onClick={() => onJumpToSource(entry)}
                              disabled={!sourceJumpEnabled}
                              title={sourceJumpEnabled ? "跳转到原文句子" : "当前文章和已保存文章里没有找到这句话"}
                            >
                              定位原句
                            </button>
                          )}
                        </div>
                        <div className="mt-1 space-y-1">
                          <p className="text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                            原型：{originalFormLabel(entry.lemma, entry.word)} · {normalizePartOfSpeechLabel(entry.partOfSpeech)}
                          </p>
                          {entryPhonetic && (
                            <p className="text-sm leading-5 tracking-[-0.224px] text-[#555555]">
                              <span className="font-medium text-[#7a7a7a]">当前词音标：</span>{entryPhonetic}
                            </p>
                          )}
                        </div>
                        <div className="mt-2"><PronunciationButtons text={entry.word} /></div>
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
                      {isStandalone ? (
                        <div>
                          <dt className="font-semibold text-[#1d1d1f]">
                            {isStandaloneChineseToEnglish ? "英文表达" : "中文释义"}
                          </dt>
                          <dd className="whitespace-pre-line">{entry.basicMeaning}</dd>
                        </div>
                      ) : (
                        <>
                          <div>
                            <dt className="font-semibold text-[#1d1d1f]">{meaningLabel(entry.word)}</dt>
                            <dd>{entry.contextMeaning}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-[#1d1d1f]">基础释义</dt>
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
                        </>
                      )}
                    </dl>

                    {hasExtendedDetails && isExpanded && (
                      <div id={`vocabulary-details-${entry.id}`}>
                        {isStandalone ? (
                          <VocabularyLearningDetails entry={entry} />
                        ) : (
                          <dl className="mt-3 grid gap-3 text-sm leading-6 tracking-[-0.224px] text-[#333333]">
                            {entry.usageNote && (
                              <div>
                                <dt className="font-semibold text-[#1d1d1f]">用法提示</dt>
                                <dd className="whitespace-pre-line">{entry.usageNote}</dd>
                              </div>
                            )}
                            {entry.collocation && (
                              <div>
                                <dt className="font-semibold text-[#1d1d1f]">常见搭配</dt>
                                <dd className="whitespace-pre-line">{entry.collocation}</dd>
                              </div>
                            )}
                            {(entry.exampleEnglish || entry.exampleChinese) && (
                              <div>
                                <dt className="font-semibold text-[#1d1d1f]">例句</dt>
                                {entry.exampleEnglish && <dd>{entry.exampleEnglish}</dd>}
                                {entry.exampleChinese && <dd className="text-[#555555]">{entry.exampleChinese}</dd>}
                              </div>
                            )}
                          </dl>
                        )}
                      </div>
                    )}

                    {showAnkiActions && entry.anki.cardMode === "basic_cn_to_en" && (
                      <p className="mt-3 hidden rounded-[18px] bg-[#f5f5f7] px-3 py-2 text-sm tracking-[-0.224px] text-[#333333] lg:block">
                        原句中无法可靠定位并挖空该词，导入时将使用“基础释义中译英卡”。
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
                        className="h-9 rounded-full border border-[#e0e0e0] px-4 text-sm tracking-[-0.224px] text-[#333333] transition active:scale-95"
                        onClick={() => onDelete(entry.id)}
                      >
                        删除
                      </button>
                    </div>

                    {hasExtendedDetails && (
                      <button
                        type="button"
                        className="mt-3 text-sm font-medium tracking-[-0.224px] text-[#0066cc] underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                        aria-expanded={isExpanded}
                        aria-controls={`vocabulary-details-${entry.id}`}
                        onClick={() =>
                          setExpandedEntryIds((current) => {
                            const next = new Set(current);
                            if (next.has(entry.id)) {
                              next.delete(entry.id);
                            } else {
                              next.add(entry.id);
                            }
                            return next;
                          })
                        }
                      >
                        {isExpanded ? "收起全文" : "显示全文"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
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
