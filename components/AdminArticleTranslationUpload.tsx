"use client";

import { useEffect, useMemo, useState } from "react";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import {
  createArticleTranslationCacheKey,
  getCachedArticleTranslation,
  getCachedArticleTranslationForBlocks,
  setCachedArticleTranslation,
  setCachedArticleTranslationForBlocks,
} from "@/lib/cache";
import type { PublicArticle, PublicArticleTranslation } from "@/types/publicArticle";
import type { ArticleTranslationItem } from "@/types/reader";

interface AdminArticleTranslationUploadProps {
  article: PublicArticle;
  open: boolean;
  onClose: () => void;
  onUploaded: (translation: PublicArticleTranslation) => void;
}

function completeTranslations(
  blockIds: string[],
  translations: ArticleTranslationItem[] | null | undefined,
): ArticleTranslationItem[] | null {
  const byId = new Map((translations ?? []).map((item) => [item.id, item.translation.trim()]));
  if (!blockIds.length || blockIds.some((id) => !byId.get(id))) return null;
  return blockIds.map((id) => ({ id, translation: byId.get(id) ?? "" }));
}

export default function AdminArticleTranslationUpload({
  article,
  open,
  onClose,
  onUploaded,
}: AdminArticleTranslationUploadProps) {
  const blocks = useMemo(
    () => createArticleTranslationBlocks(article.body, article.importedArticle ?? null),
    [article.body, article.importedArticle],
  );
  const cacheKey = useMemo(() => createArticleTranslationCacheKey(blocks), [blocks]);
  const blockIds = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const cacheReadKey = open ? cacheKey : `closed:${cacheKey}`;
  const localTranslation = useMemo(() => {
    const effectiveCacheKey = cacheReadKey.replace(/^closed:/, "");
    const exact = completeTranslations(blockIds, getCachedArticleTranslation(effectiveCacheKey));
    if (exact) return exact;
    return completeTranslations(blockIds, getCachedArticleTranslationForBlocks(blocks));
  }, [blockIds, blocks, cacheReadKey]);
  const publishedTranslation = useMemo(
    () => completeTranslations(
      blockIds,
      article.articleTranslations?.find((item) => item.cacheKey === cacheKey)?.translations,
    ),
    [article.articleTranslations, blockIds, cacheKey],
  );
  const currentTranslation = localTranslation ?? publishedTranslation;
  const [mode, setMode] = useState<"current" | "paste">(currentTranslation ? "current" : "paste");
  const [pastedText, setPastedText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(currentTranslation ? "current" : "paste");
    setPastedText("");
    setError("");
  }, [cacheKey, currentTranslation, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uploading) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, uploading]);

  const pastedParagraphs = useMemo(
    () => pastedText.trim() ? pastedText.trim().split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean) : [],
    [pastedText],
  );
  const pastedTranslation = pastedParagraphs.length === blocks.length
    ? blocks.map((block, index) => ({ id: block.id, translation: pastedParagraphs[index] }))
    : null;
  const selectedTranslation = mode === "current" ? currentTranslation : pastedTranslation;

  if (!open) return null;

  async function upload() {
    if (!selectedTranslation || uploading) return;
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/public-article-translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id, cacheKey, translations: selectedTranslation }),
      });
      const data = await response.json().catch(() => null) as { translation?: PublicArticleTranslation; error?: string } | null;
      if (!response.ok || !data?.translation) throw new Error(data?.error || "全文翻译上传失败。");
      setCachedArticleTranslation(cacheKey, data.translation.translations);
      setCachedArticleTranslationForBlocks(blocks, data.translation.translations);
      onUploaded(data.translation);
      onClose();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "全文翻译上传失败。");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#0b1620]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !uploading) onClose();
    }}>
      <section className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="translation-upload-title">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#dfe4e8] px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold text-[#1769aa]">精选文章 · 正文版本 {cacheKey}</p>
            <h2 id="translation-upload-title" className="mt-1 text-xl font-semibold text-[#17212b]">上传全文翻译</h2>
            <p className="mt-1 text-sm text-[#68737c]">《{article.title}》共 {blocks.length} 个正文段落。上传后，用户首次点击仍扣 1 次全文翻译额度，但 DeepSeek 成本为 0。</p>
          </div>
          <button className="h-9 w-9 shrink-0 rounded-full bg-[#f1f4f6] text-xl text-[#35414b]" type="button" aria-label="关闭上传全文翻译" onClick={onClose} disabled={uploading}>×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="译文来源">
            <button className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "current" ? "bg-[#17212b] text-white" : "bg-[#eef2f5] text-[#35414b]"}`} type="button" role="tab" aria-selected={mode === "current"} disabled={!currentTranslation} onClick={() => setMode("current")}>上传当前译文{currentTranslation ? "" : "（暂无）"}</button>
            <button className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === "paste" ? "bg-[#17212b] text-white" : "bg-[#eef2f5] text-[#35414b]"}`} type="button" role="tab" aria-selected={mode === "paste"} onClick={() => setMode("paste")}>粘贴整篇中文</button>
          </div>

          {mode === "paste" && (
            <div className="mt-5">
              <label className="block text-sm font-semibold text-[#27333d]" htmlFor="admin-pasted-translation">每个中文段落之间空一行</label>
              <textarea id="admin-pasted-translation" className="mt-2 min-h-48 w-full resize-y rounded-xl border border-[#c9d0d6] px-4 py-3 text-[15px] leading-7 outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" value={pastedText} onChange={(event) => setPastedText(event.target.value)} placeholder="第一段中文译文……\n\n第二段中文译文……" />
              <p className={`mt-2 text-sm ${pastedParagraphs.length === blocks.length ? "text-[#247044]" : "text-[#9a5a15]"}`}>已识别 {pastedParagraphs.length} 段，需要 {blocks.length} 段。{pastedParagraphs.length === blocks.length ? "可以预览并确认上传。" : "段落数一致后才能上传。"}</p>
            </div>
          )}

          <div className="mt-6 border-t border-[#dfe4e8] pt-5">
            <h3 className="text-sm font-semibold text-[#27333d]">逐段预览</h3>
            <ol className="mt-3 divide-y divide-[#e5e9ec]">
              {blocks.map((block, index) => {
                const translation = mode === "current" ? currentTranslation?.[index]?.translation : pastedParagraphs[index];
                return (
                  <li key={block.id} className="grid gap-2 py-4 md:grid-cols-2 md:gap-6">
                    <div><span className="text-[11px] font-semibold uppercase tracking-wide text-[#8a949d]">原文 {index + 1}</span><p className="mt-1 text-sm leading-6 text-[#27333d]">{block.text}</p></div>
                    <div><span className="text-[11px] font-semibold uppercase tracking-wide text-[#8a949d]">译文 {index + 1}</span><p className={`mt-1 text-sm leading-6 ${translation ? "text-[#27333d]" : "text-[#a46320]"}`}>{translation || "等待对应的中文段落"}</p></div>
                  </li>
                );
              })}
            </ol>
          </div>
          {error && <p className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#a12a22]" role="alert">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#dfe4e8] bg-[#fafbfc] px-5 py-4 sm:px-6">
          <p className="hidden text-xs text-[#68737c] sm:block">确认时会再次校验正文哈希；正文已变化则拒绝上传。</p>
          <div className="ml-auto flex gap-2">
            <button className="min-h-10 rounded-full px-4 text-sm font-semibold text-[#4d5861]" type="button" onClick={onClose} disabled={uploading}>取消</button>
            <button className="min-h-10 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white disabled:bg-[#aeb8c2]" type="button" onClick={() => void upload()} disabled={!selectedTranslation || uploading}>{uploading ? "正在上传…" : "确认上传"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
