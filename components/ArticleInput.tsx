"use client";

import { useEffect, useState } from "react";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { isValidArticleSummary } from "@/lib/articles";
import { downloadVocabularyCsv } from "@/lib/csv";
import { clearVocabularyEntries, deleteVocabularyEntry, getVocabularyEntries } from "@/lib/vocabulary";
import type { SavedArticle } from "@/types/article";
import type { PublicArticle } from "@/types/publicArticle";
import type { VocabularyEntry } from "@/types/vocabulary";

const IMAGE_OCR_ENABLED = false;

interface ArticleInputProps {
  article: string;
  articleUrl: string;
  error: string;
  urlError: string;
  ocrError: string;
  importingUrl: boolean;
  ocrLoading: boolean;
  openingPublicArticleId: string;
  initialPublicArticles: PublicArticle[];
  savedArticles: SavedArticle[];
  onArticleChange: (article: string) => void;
  onArticleUrlChange: (url: string) => void;
  onStartReading: () => void;
  onImportUrl: () => void;
  onOcrImage: (file: File | null) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onOpenPublicArticle: (id: string) => void;
  onDeleteSavedArticle: (id: string) => void;
}

function articleSummaryText(savedArticle: SavedArticle): string {
  const summary = savedArticle.summary.trim();
  if (!isValidArticleSummary(summary)) {
    return "这篇文章还没有有效中文摘要，请进入文章后重新保存。";
  }
  return summary;
}

export function ArticleInput({
  article,
  articleUrl,
  error,
  urlError,
  ocrError,
  importingUrl,
  ocrLoading,
  initialPublicArticles,
  savedArticles,
  onArticleChange,
  onArticleUrlChange,
  onStartReading,
  onImportUrl,
  onOcrImage,
  openingPublicArticleId,
  onOpenSavedArticle,
  onOpenPublicArticle,
  onDeleteSavedArticle,
}: ArticleInputProps) {
  const hasArticle = article.trim().length > 0;
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const [vocabularyError, setVocabularyError] = useState("");
  const [publicArticles] = useState<PublicArticle[]>(initialPublicArticles);

  useEffect(() => {
    setVocabularyEntries(getVocabularyEntries());
  }, []);

  function handleOpenVocabulary() {
    setVocabularyEntries(getVocabularyEntries());
    setVocabularyError("");
    setVocabularyOpen(true);
  }

  function handleDeleteVocabulary(id: string) {
    setVocabularyEntries(deleteVocabularyEntry(id));
  }

  function handleClearVocabulary() {
    if (!window.confirm("确定要清空生词本吗？")) {
      return;
    }
    clearVocabularyEntries();
    setVocabularyEntries([]);
  }

  function handleExportVocabularyCsv() {
    try {
      downloadVocabularyCsv(vocabularyEntries);
    } catch (csvError) {
      setVocabularyError(csvError instanceof Error ? csvError.message : "CSV 导出失败，请稍后重试。");
    }
  }

  async function handleCopyVocabularyEntry(entry: VocabularyEntry) {
    const text = [
      `${entry.word} (${entry.lemma})`,
      entry.phonetic ? `音标：${entry.phonetic}` : "",
      `词性：${entry.partOfSpeech}`,
      `基础释义：${entry.basicMeaning}`,
      `语境含义：${entry.contextMeaning}`,
      `原句：${entry.sourceSentence}`,
      `自然翻译：${entry.sentenceTranslation}`,
      `用法说明：${entry.usageNote}`,
      entry.collocation ? `常见搭配：${entry.collocation}` : "",
      `例句：${entry.exampleEnglish}`,
      `例句翻译：${entry.exampleChinese}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setVocabularyError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <section className="mx-auto grid min-h-screen max-w-7xl gap-3 px-3 py-4 sm:px-4 lg:h-screen lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-h-[calc(100vh-32px)] min-w-0 flex-col rounded-[24px] bg-white p-4 sm:p-5 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e0e0e0] pb-5 pt-1">
            <div>
              <h1 className="text-[32px] font-semibold leading-[1.08] tracking-normal text-[#1d1d1f] sm:text-[42px] sm:leading-[1.05]">
                Context Reader
              </h1>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <button
                className="h-10 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95"
                type="button"
                onClick={handleOpenVocabulary}
              >
                生词本
              </button>
              <button
                className="h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
                type="button"
                onClick={() => onArticleChange("")}
                disabled={!hasArticle}
              >
                清空
              </button>
            </div>
          </div>

          <textarea
            id="article-text"
            className="mt-4 min-h-[220px] w-full flex-1 resize-none rounded-[18px] border border-[#e0e0e0] bg-[#fafafc] p-5 text-[17px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20 lg:min-h-0"
            value={article}
            onChange={(event) => onArticleChange(event.target.value)}
            placeholder="Paste your English article here..."
          />

          <div className="mt-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-h-6 text-sm text-red-600" role="alert">
              {error}
            </p>
            <div className="flex items-center gap-3">
              <button
                className="h-11 rounded-full border border-[#0066cc] px-[22px] text-[17px] font-normal leading-none tracking-[-0.374px] text-[#0066cc] transition active:scale-95 sm:hidden"
                type="button"
                onClick={handleOpenVocabulary}
              >
                生词本
              </button>
              <button
                className="h-11 rounded-full border border-[#0066cc] px-[22px] text-[17px] font-normal leading-none tracking-[-0.374px] text-[#0066cc] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#7a7a7a] sm:hidden"
                type="button"
                onClick={() => onArticleChange("")}
                disabled={!hasArticle}
              >
                清空
              </button>
              <button
                className="h-11 rounded-full bg-[#0066cc] px-[22px] text-[17px] font-normal leading-none tracking-[-0.374px] text-white transition active:scale-95"
                type="button"
                onClick={onStartReading}
              >
                开始阅读
              </button>
            </div>
          </div>

          <section className="mt-4 shrink-0 rounded-[18px] border border-[#e0e0e0] bg-[#fafafc] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.224px] text-[#1d1d1f]">
                  推荐文章
                </h2>
                <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                  公开文章会随网站缓存，离线时可继续打开已缓存内容。
                </p>
              </div>
            </div>
            {publicArticles.length === 0 ? (
              <p className="mt-4 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                暂无公开推荐文章。
              </p>
            ) : (
              <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                {publicArticles.map((publicArticle) => (
                  <button
                    key={publicArticle.id}
                    type="button"
                    className="min-h-[104px] w-[min(280px,78vw)] shrink-0 rounded-[16px] border border-[#e0e0e0] bg-white p-4 text-left transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
                    onClick={() => onOpenPublicArticle(publicArticle.id)}
                    disabled={Boolean(openingPublicArticleId)}
                  >
                    <span className="block text-sm font-semibold leading-5 tracking-[-0.224px] text-[#1d1d1f]">
                      {publicArticle.title}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-sm leading-5 tracking-[-0.224px] text-[#333333]">
                      {openingPublicArticleId === publicArticle.id
                        ? "正在打开..."
                        : publicArticle.summary || "公开推荐英文阅读文章"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </section>

        <aside className="grid min-h-0 gap-3 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
          <section className="rounded-[24px] bg-white p-4 sm:p-5">
            <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
              URL 导入文章
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              <div className="relative flex-1">
                <label className="sr-only" htmlFor="article-url">
                  文章 URL
                </label>
                <input
                  id="article-url"
                  className="h-11 w-full rounded-full border border-black/10 bg-white py-0 pl-5 pr-12 text-[17px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f] outline-none transition focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                  value={articleUrl}
                  onChange={(event) => onArticleUrlChange(event.target.value)}
                  placeholder="https://example.com/article"
                  type="url"
                />
                {articleUrl && (
                  <button
                    type="button"
                    aria-label="清空 URL"
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[20px] leading-none text-[#6e6e73] transition hover:bg-[#f5f5f7] hover:text-[#1d1d1f] active:scale-95"
                    onClick={() => onArticleUrlChange("")}
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                className="h-11 rounded-full bg-[#0066cc] px-[22px] text-[17px] font-normal leading-none tracking-[-0.374px] text-white transition active:scale-95 disabled:cursor-not-allowed disabled:bg-[#d2d2d7]"
                type="button"
                onClick={onImportUrl}
                disabled={importingUrl}
              >
                {importingUrl ? "导入中..." : "导入 URL"}
              </button>
            </div>
            <p className="mt-3 min-h-5 text-sm leading-5 text-red-600" role="alert">
              {urlError}
            </p>
          </section>

          {IMAGE_OCR_ENABLED && (
          <section className="rounded-[24px] bg-white p-4 sm:p-5">
            <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
              图片 OCR
            </h2>
            <div className="mt-4">
              <label className="block">
                <span className="sr-only">上传图片 OCR</span>
                <input
                  id="ocr-image"
                  className="block w-full text-sm tracking-[-0.224px] text-[#333333] file:mr-4 file:h-10 file:rounded-full file:border-0 file:bg-[#0066cc] file:px-4 file:text-sm file:tracking-[-0.224px] file:text-white"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    onOcrImage(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                  disabled={ocrLoading}
                />
              </label>
              <p className="mt-3 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                {ocrLoading ? "正在识别图片..." : "截图、扫描图或不能复制的文章图片。"}
              </p>
            </div>
            <p className="mt-3 min-h-5 text-sm leading-5 text-red-600" role="alert">
              {ocrError}
            </p>
          </section>
          )}

          <section className="min-h-[180px] overflow-y-auto rounded-[24px] bg-white p-4 sm:p-5 lg:min-h-0">
          <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">
            已保存文章
          </h2>
          <p className="mt-2 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
            点击摘要可直接进入阅读。
          </p>

          {savedArticles.length === 0 ? (
            <p className="mt-8 text-[17px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">
              还没有保存过文章。
            </p>
          ) : (
            <ul className="mt-6 space-y-3">
              {savedArticles.map((savedArticle) => (
                <li key={savedArticle.id} className="rounded-[18px] border border-[#e0e0e0] bg-white p-4">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onOpenSavedArticle(savedArticle)}
                  >
                    <span className="block text-xs leading-4 tracking-[-0.12px] text-[#7a7a7a]">
                      {new Date(savedArticle.updatedAt).toLocaleString()}
                    </span>
                    <span className="mt-2 block text-sm font-semibold leading-5 tracking-[-0.224px] text-[#1d1d1f]">
                      {articleSummaryText(savedArticle)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mt-3 text-sm leading-5 tracking-[-0.224px] text-[#0066cc]"
                    onClick={() => onDeleteSavedArticle(savedArticle.id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          </section>
        </aside>
      </section>
      <VocabularyPanel
        entries={vocabularyEntries}
        open={vocabularyOpen}
        importingId=""
        importError={vocabularyError}
        placement="dialog"
        showAnkiActions={false}
        onClose={() => setVocabularyOpen(false)}
        onDelete={handleDeleteVocabulary}
        onClear={handleClearVocabulary}
        onExportCsv={handleExportVocabularyCsv}
        onCopy={handleCopyVocabularyEntry}
        onImportAnki={() => undefined}
        onImportAllAnki={() => undefined}
      />
    </main>
  );
}
