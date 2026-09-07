"use client";

import type { Ref } from "react";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

interface ArticleTranslationPanelProps {
  blocks: ArticleTranslationBlock[];
  translations: ArticleTranslationItem[];
  loading: boolean;
  error: string;
  requested: boolean;
  estimatedSecondsRemaining: number | null;
  retryAfterSeconds: number | null;
  retryReason: string | null;
  regenerating: boolean;
  completedTargetBlocks: number;
  totalTargetBlocks: number;
  staleBlockIds?: string[];
  removedTranslationCount?: number;
  adminMode?: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  scrollContainerRef?: Ref<HTMLElement>;
}

export function ArticleTranslationPanel({
  blocks, translations, loading, error, requested, estimatedSecondsRemaining, retryAfterSeconds, retryReason,
  regenerating, completedTargetBlocks, totalTargetBlocks,
  staleBlockIds = [], removedTranslationCount = 0, adminMode = false, onGenerate, onRegenerate, scrollContainerRef,
}: ArticleTranslationPanelProps) {
  const translationById = new Map(translations.map((item) => [item.id, item.translation]));
  const hasTranslations = translations.length > 0;
  const hasIncompleteTranslations = translations.length < blocks.length;
  const hasOutdatedTranslations = staleBlockIds.length > 0 || removedTranslationCount > 0;
  const updateButtonLabel = hasOutdatedTranslations ? "更新修改" : "重新生成全文翻译";
  const estimateText = estimatedSecondsRemaining === null
    ? "正在估算剩余时间"
    : estimatedSecondsRemaining <= 0
      ? "即将完成"
      : estimatedSecondsRemaining < 60
        ? `预计还需约 ${estimatedSecondsRemaining} 秒`
        : `预计还需约 ${Math.ceil(estimatedSecondsRemaining / 60)} 分钟`;
  const retryProgressText = translations.length > 0
    ? `已生成 ${translations.length}/${blocks.length} 段，已生成内容不会丢失。`
    : "本次尚未生成可显示译文。";
  const retryText = retryAfterSeconds === null
    ? null
    : `${retryReason ?? "翻译服务正在等待恢复。"}约 ${retryAfterSeconds} 秒后自动继续。${retryProgressText}`;
  const activeProgressText = regenerating
    ? `正在重新翻译，已更新 ${completedTargetBlocks}/${totalTargetBlocks} 段；其余段落继续显示上一次译文。${estimateText}`
    : `已生成 ${translations.length}/${blocks.length} 段，剩余内容正在后台翻译。${estimateText}`;

  return (
    <aside ref={scrollContainerRef} className="cr-reader-panel cr-translation-panel h-full min-h-0 overflow-y-auto rounded-[14px] border border-[#e0e0e0] bg-white p-5 overscroll-contain [-webkit-overflow-scrolling:touch]" data-native-selection="blue">
      <header className="flex items-start justify-between gap-3 border-b border-[#e0e0e0] pb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6 tracking-[-0.224px] text-[#1d1d1f]">全文翻译</h2>
          <p className="mt-1 text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">{adminMode ? "候选文章已有完整译文时，精选后会自动同步给用户。" : "按原文段落对齐，优先保持术语、指代和上下文一致。"}</p>
        </div>
        {hasTranslations && (
          <button type="button" className="cr-translation-regenerate flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#0066cc] text-lg leading-none text-[#0066cc] transition hover:bg-[#f5f9ff] active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#86868b]" onClick={onRegenerate} disabled={loading || blocks.length === 0} aria-label={updateButtonLabel} title={updateButtonLabel}>↻</button>
        )}
      </header>

      {!requested && !hasTranslations && !loading && !error && (
        <div className="py-6">
          <p className="text-sm leading-6 tracking-[-0.224px] text-[#333333]">点击开始后，即使切回词句解释或打开其他文章，也会继续在后台翻译。</p>
          <button type="button" className="cr-translation-primary mt-4 h-10 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]" onClick={onGenerate} disabled={blocks.length === 0}>开始翻译</button>
        </div>
      )}

      {loading && !hasTranslations && (
        <div className="py-6">
          <div className="cr-translation-skeleton space-y-3"><div className="h-4 w-5/6 rounded-full bg-[#ececf0]" /><div className="h-4 w-full rounded-full bg-[#ececf0]" /><div className="h-4 w-2/3 rounded-full bg-[#ececf0]" /></div>
          <p className="mt-4 text-sm leading-6 tracking-[-0.224px] text-[#333333]">{retryText ?? "正在后台翻译，切回词句解释也会继续。"}</p>
          <p className="mt-2 rounded-[14px] bg-[#f5f5f7] px-3 py-2 text-xs leading-5 tracking-[-0.12px] text-[#333333]">{estimateText}</p>
        </div>
      )}

      {error && !loading && (
        <div className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
          <div className="flex items-start justify-between gap-3"><p className="min-w-0">{error}</p><button type="button" className="cr-translation-retry flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 bg-white text-base leading-none text-red-700 transition hover:bg-red-100 active:scale-95" onClick={onGenerate} aria-label="继续未完成的全文翻译" title="继续未完成的全文翻译">↻</button></div>
          {adminMode && <p className="mt-3 border-t border-red-200 pt-3 text-xs leading-5">本次生成失败，请重试。</p>}
        </div>
      )}

      {hasTranslations && (
        <div className="space-y-5 py-5">
          {loading && <div className="cr-translation-status rounded-[14px] bg-[#f5f5f7] px-3 py-2 text-xs leading-5 tracking-[-0.12px] text-[#333333]"><p>{retryText ?? activeProgressText}</p></div>}
          {!loading && !error && hasIncompleteTranslations && (
            <div className="cr-translation-status flex items-center justify-between gap-3 rounded-[14px] bg-[#f5f5f7] px-3 py-2 text-xs leading-5 tracking-[-0.12px] text-[#333333]">
              <p>已保留 {translations.length}/{blocks.length} 段，可从缺失处继续。</p>
              <button type="button" className="cr-translation-primary shrink-0 rounded-full bg-[#0066cc] px-3 py-1.5 text-white transition active:scale-95" onClick={onGenerate}>继续翻译</button>
            </div>
          )}
          {hasOutdatedTranslations && !loading && <div className="cr-translation-warning rounded-[14px] bg-[#fff8e5] px-3 py-2 text-xs leading-5 tracking-[-0.12px] text-[#6b4b00]">{staleBlockIds.length > 0 && removedTranslationCount > 0 ? `有 ${staleBlockIds.length} 段原文已修改，${removedTranslationCount} 段已删除。点击右上角只更新修改部分并同步移除旧译文。` : staleBlockIds.length > 0 ? `有 ${staleBlockIds.length} 段原文已修改。点击右上角只更新修改部分。` : `有 ${removedTranslationCount} 段原文已删除。点击右上角同步移除旧译文。`}</div>}
          {blocks.map((block) => {
            const translation = translationById.get(block.id);
            if (!translation) return null;
            const isHeading = block.type === "heading" || block.type === "subheading";
            return <section key={block.id} className="border-b border-[#f0f0f2] pb-4 last:border-b-0 last:pb-0"><p className="cr-translation-source text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">{block.text}</p><p className={`cr-translation-target mt-2 tracking-[-0.224px] text-[#1d1d1f] ${isHeading ? "text-base font-semibold leading-7" : "text-sm leading-6"}`}>{translation}</p></section>;
          })}
        </div>
      )}

      {requested && !loading && !hasTranslations && !error && <p className="py-6 text-sm leading-6 tracking-[-0.224px] text-[#333333]">暂无可显示的译文，请点击开始翻译重试。</p>}
    </aside>
  );
}
