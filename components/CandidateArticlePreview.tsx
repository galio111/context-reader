"use client";

import { useEffect, useMemo } from "react";
import type { ImportedArticleBlock } from "@/types/article";
import type { PublicArticle } from "@/types/publicArticle";

interface CandidateArticlePreviewProps {
  article: PublicArticle;
  onClose: () => void;
}

function fallbackBlocks(article: PublicArticle): ImportedArticleBlock[] {
  return article.body
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `preview-${index}`, type: index === 0 ? "heading" : "paragraph", text }));
}

function sourceLabel(article: PublicArticle): string {
  if (article.sourceName.trim()) return article.sourceName.trim();
  if (!article.sourceUrl.trim()) return "";
  try {
    return new URL(article.sourceUrl).hostname;
  } catch {
    return article.sourceUrl;
  }
}

export default function CandidateArticlePreview({ article, onClose }: CandidateArticlePreviewProps) {
  const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
  const source = sourceLabel(article);
  const blocks = useMemo(
    () => article.importedArticle?.blocks?.length ? article.importedArticle.blocks : fallbackBlocks(article),
    [article],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[#e7ebef]" role="dialog" aria-modal="true" aria-label={`预览 ${article.title}`}>
      <header className="sticky top-0 z-10 border-b border-[#d6dce2] bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#17191c]">用户视图预览</p>
            <p className="truncate text-xs text-[#68717a]">查词交互将在开发者账号与后台打通后加入</p>
          </div>
          <button className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[#b8c7d5] px-4 text-sm font-medium text-[#175a8d] hover:bg-[#edf5fb]" type="button" onClick={onClose}>关闭预览</button>
        </div>
      </header>

      <div className="h-[calc(100vh-65px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
          <section className="overflow-hidden rounded-2xl bg-white">
            {recommendation?.coverImageUrl && (
              <div className="aspect-[16/7] bg-[#dfe5ea]">
                <img className="h-full w-full object-cover" src={recommendation.coverImageUrl} alt={recommendation.coverImageAlt || article.title} />
              </div>
            )}
            <div className="px-5 py-6 sm:px-9 sm:py-8">
              <div className="flex flex-wrap gap-2 text-xs font-medium text-[#174d73]">
                {recommendation?.topics.map((topic) => <span key={topic} className="rounded-full bg-[#edf5fb] px-3 py-1">{topic}</span>)}
                {recommendation?.difficulty && <span className="rounded-full bg-[#eef1f4] px-3 py-1 text-[#4d535a]">{recommendation.difficulty}</span>}
                {recommendation?.readingMinutes && <span className="rounded-full bg-[#eef1f4] px-3 py-1 text-[#4d535a]">约 {recommendation.readingMinutes} 分钟</span>}
              </div>
              <h1 className="mt-4 max-w-4xl text-balance text-3xl font-semibold leading-tight tracking-[-0.025em] text-[#17191c] sm:text-5xl">{article.title}</h1>
              {article.summary && <p className="mt-4 max-w-3xl text-pretty text-base leading-7 text-[#4d535a] sm:text-lg sm:leading-8">{article.summary}</p>}
              {source && <p className="mt-4 text-sm text-[#68717a]">来源：{source}</p>}
            </div>
          </section>

          <article className="mx-auto mt-6 max-w-[760px] rounded-2xl bg-white px-5 py-7 text-[#202428] sm:px-10 sm:py-11">
            {blocks.map((block) => {
              if (block.type === "image" && block.src) {
                return <figure key={block.id} className="my-8"><img className="mx-auto max-h-[72vh] max-w-full rounded-lg object-contain" src={block.src} alt={block.alt || "文章配图"} />{block.alt && <figcaption className="mt-2 text-center text-xs leading-5 text-[#68717a]">{block.alt}</figcaption>}</figure>;
              }
              if (!block.text) return null;
              if (block.type === "heading") return <h2 key={block.id} className="mb-6 mt-2 text-balance text-3xl font-semibold leading-tight tracking-[-0.02em]">{block.text}</h2>;
              if (block.type === "subheading") return <h3 key={block.id} className="mb-3 mt-9 text-xl font-semibold leading-snug">{block.text}</h3>;
              if (block.type === "quote") return <blockquote key={block.id} className="my-7 rounded-xl bg-[#f1f4f6] px-5 py-4 text-lg leading-8 text-[#3f4850]">{block.text}</blockquote>;
              if (block.type === "list-item") return <p key={block.id} className="my-2 pl-5 text-[17px] leading-8 before:mr-3 before:content-['•']">{block.text}</p>;
              return <p key={block.id} className="my-5 whitespace-pre-wrap text-[17px] leading-8">{block.text}</p>;
            })}
          </article>
        </main>
      </div>
    </div>
  );
}
