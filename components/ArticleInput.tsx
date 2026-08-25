"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HomeReadingDemo } from "@/components/HomeReadingDemo";
import ClearableField from "@/components/ClearableField";
import { ImmersiveHome } from "@/components/ImmersiveHome";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { isValidArticleSummary } from "@/lib/articles";
import { currentFormPhonetic } from "@/lib/pronunciation";
import { downloadVocabularyCsv } from "@/lib/csv";
import { clearVocabularyEntries, deleteVocabularyEntry, getVocabularyEntries } from "@/lib/vocabulary";
import type { SavedArticle } from "@/types/article";
import type { PublicArticle } from "@/types/publicArticle";
import type { VocabularyEntry } from "@/types/vocabulary";
import { useAccount } from "@/components/AccountProvider";

const IMAGE_OCR_ENABLED = false;

type InputMode = "paste" | "url" | "image";

interface ArticleInputProps {
  article: string;
  articleUrl: string;
  error: string;
  urlError: string;
  ocrError: string;
  importingUrl: boolean;
  ocrLoading: boolean;
  openingPublicArticleId: string;
  homeDemoCompleted: boolean;
  initialPublicArticles: PublicArticle[];
  savedArticles: SavedArticle[];
  onArticleChange: (article: string) => void;
  onArticleUrlChange: (url: string) => void;
  onStartReading: () => void;
  onImportUrl: () => void;
  onOcrImage: (file: File | null) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onOpenPublicArticle: (id: string) => Promise<void>;
  onPrefetchPublicArticle: (id: string) => void;
  onDeleteSavedArticle: (id: string) => void;
  onJumpToVocabularySource: (entry: VocabularyEntry) => void;
  canJumpToVocabularySource: (entry: VocabularyEntry) => boolean;
}

function articleSummaryText(savedArticle: SavedArticle): string {
  const summary = savedArticle.summary.trim();
  return isValidArticleSummary(summary) ? summary : "进入文章继续阅读，保存后会生成中文摘要。";
}

function formatArticleDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(date));
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
      <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M5 4.75h9.25A2.75 2.75 0 0 1 17 7.5v11H7.75A2.75 2.75 0 0 0 5 21.25V4.75Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M17 18.5h2V7.75" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
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
  homeDemoCompleted,
  onOpenSavedArticle,
  onOpenPublicArticle,
  onPrefetchPublicArticle,
  onDeleteSavedArticle,
  onJumpToVocabularySource,
  canJumpToVocabularySource,
}: ArticleInputProps) {
  const { hasLocalAccountAccess, requireLocalAccount } = useAccount();
  const hasArticle = article.trim().length > 0;
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const [vocabularyError, setVocabularyError] = useState("");
  const articleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const workbenchRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const refreshVocabularyEntries = () => setVocabularyEntries(getVocabularyEntries());
    refreshVocabularyEntries();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
    return () => window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
  }, []);

  useEffect(() => {
    if (!article) articleInputRef.current?.scrollTo({ top: 0, left: 0 });
  }, [article]);

  useEffect(() => {
    document.documentElement.classList.toggle("cr-overlay-locked", vocabularyOpen);
    document.body.classList.toggle("cr-overlay-locked", vocabularyOpen);
    return () => {
      document.documentElement.classList.remove("cr-overlay-locked");
      document.body.classList.remove("cr-overlay-locked");
    };
  }, [vocabularyOpen]);

  function handleOpenVocabulary() {
    if (!requireLocalAccount("登录后才能使用生词本；登录时会把本机已有词条补充到账号中。")) return;
    setVocabularyEntries(getVocabularyEntries());
    setVocabularyError("");
    setVocabularyOpen(true);
  }

  function handleClearVocabulary() {
    const confirmed = window.confirm(
      `将删除生词本中的 ${vocabularyEntries.length} 条词条，此操作无法撤销。\n\n确定要清空生词本吗？`,
    );
    if (!confirmed) return;
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
    const phonetic = currentFormPhonetic(entry);
    const contextMeaningLabel = entry.word.trim().split(/\s+/).filter(Boolean).length > 1
      ? "所选短语在本句中的含义"
      : "所选词在本句中的含义";
    const text = [
      `当前词：${entry.word}`,
      entry.lemma ? `原型：${entry.lemma}` : "",
      phonetic ? `当前词音标（${entry.word}）：${phonetic}` : "",
      `词性：${entry.partOfSpeech}`,
      `基础释义：${entry.basicMeaning}`,
      `${contextMeaningLabel}：${entry.contextMeaning}`,
      `原句：${entry.sourceSentence}`,
      `自然翻译：${entry.sentenceTranslation}`,
      `用法说明：${entry.usageNote}`,
      entry.collocation ? `常见搭配：${entry.collocation}` : "",
      `例句：${entry.exampleEnglish}`,
      `例句翻译：${entry.exampleChinese}`,
    ].filter(Boolean).join("\n");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setVocabularyError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  function scrollToWorkbench() {
    workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => articleInputRef.current?.focus(), 450);
  }

  const immersiveHomepageEnabled = true;
  if (immersiveHomepageEnabled) {
    return (
      <>
        <ImmersiveHome
          article={article}
          articleUrl={articleUrl}
          error={error}
          urlError={urlError}
          ocrError={ocrError}
          importingUrl={importingUrl}
          ocrLoading={ocrLoading}
          openingPublicArticleId={openingPublicArticleId}
          demoCompleted={homeDemoCompleted}
          publicArticles={initialPublicArticles}
          savedArticles={hasLocalAccountAccess ? savedArticles : []}
          vocabularyEntries={hasLocalAccountAccess ? vocabularyEntries : []}
          vocabularyCount={hasLocalAccountAccess ? vocabularyEntries.length : 0}
          overlayOpen={vocabularyOpen}
          onArticleChange={onArticleChange}
          onArticleUrlChange={onArticleUrlChange}
          onStartReading={onStartReading}
          onImportUrl={onImportUrl}
          onOcrImage={onOcrImage}
          onOpenPublicArticle={onOpenPublicArticle}
          onPrefetchPublicArticle={onPrefetchPublicArticle}
          onOpenSavedArticle={onOpenSavedArticle}
          onDeleteSavedArticle={onDeleteSavedArticle}
          onOpenVocabulary={handleOpenVocabulary}
        />
        <VocabularyPanel
          entries={vocabularyEntries}
          open={vocabularyOpen}
          importingId=""
          importError={vocabularyError}
          placement="dialog"
          showAnkiActions={false}
          onClose={() => setVocabularyOpen(false)}
          onDelete={(id) => setVocabularyEntries(deleteVocabularyEntry(id))}
          onClear={handleClearVocabulary}
          onExportCsv={handleExportVocabularyCsv}
          onCopy={handleCopyVocabularyEntry}
          onJumpToSource={onJumpToVocabularySource}
          canJumpToSource={canJumpToVocabularySource}
          onImportAnki={() => undefined}
          onImportAllAnki={() => undefined}
        />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f5f2] text-[#18211d]">
      <header className="border-b border-[#18211d]/10 bg-[#f3f5f2]/95">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <button className="group flex items-center text-left" type="button" onClick={scrollToWorkbench}>
            <span>
              <span className="block text-[15px] font-semibold leading-5">Context Reader</span>
              <span className="hidden text-xs text-[#5d6b65] sm:block">语境英语阅读工作台</span>
            </span>
          </button>
          <nav aria-label="首页导航" className="flex items-center gap-2">
            <button className="hidden h-10 rounded-full px-4 text-sm font-medium text-[#43524b] transition-colors hover:bg-white hover:text-[#18211d] sm:block" type="button" onClick={scrollToWorkbench}>
              开始阅读
            </button>
            <Link
              className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-[#43524b] transition-colors hover:bg-white hover:text-[#18211d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa] sm:px-4"
              href="/guide"
            >
              <span className="sm:hidden">说明</span>
              <span className="hidden sm:inline">使用说明</span>
            </Link>
            <button className="h-10 rounded-full border border-[#183f34]/20 bg-white px-4 text-sm font-medium text-[#183f34] transition-colors hover:border-[#183f34]/40 hover:bg-[#f8faf8]" type="button" onClick={handleOpenVocabulary}>
              生词本{vocabularyEntries.length > 0 ? ` · ${vocabularyEntries.length}` : ""}
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1180px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <section className="grid items-center gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14">
          <div className="max-w-[540px] py-2 lg:py-8">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#dce9df] px-3 py-1.5 text-xs font-medium text-[#285143]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2d765e]" />
              为真实英文阅读而做
            </p>
            <h1 className="max-w-[12ch] text-balance text-[42px] font-semibold leading-[1.08] tracking-[-0.035em] text-[#14231d] sm:text-[54px]">
              把英文长文读下去
            </h1>
            <p className="mt-5 max-w-[35rem] text-pretty text-[17px] leading-7 text-[#53625b] sm:text-[18px]">
              生词不必把你带离文章。点一下单词，或划选一个短语，直接看它在当前句子里的意思，再继续往下读。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button className="inline-flex h-11 items-center gap-2 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#125b94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" type="button" onClick={scrollToWorkbench}>
                粘贴文章开始阅读 <ArrowIcon />
              </button>
              {initialPublicArticles[0] && (
                <button className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[#285143] transition-colors hover:bg-white" type="button" onClick={() => onOpenPublicArticle(initialPublicArticles[0].id)} disabled={Boolean(openingPublicArticleId)}>
                  先试一篇推荐文章
                </button>
              )}
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-[#68766f]">
              <BookIcon /> 不是替你跳过英文，而是减少查词带来的中断。
            </p>
          </div>

          <HomeReadingDemo />
        </section>

        <section ref={workbenchRef} aria-labelledby="workbench-title" className="mt-10 overflow-hidden rounded-[20px] bg-white ring-1 ring-[#18211d]/10 sm:mt-14">
          <div className="flex flex-col gap-4 border-b border-[#18211d]/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <h2 id="workbench-title" className="text-xl font-semibold tracking-[-0.02em]">今天想读什么？</h2>
              <p className="mt-1 text-sm text-[#637169]">选择一种方式导入，阅读界面会保留文章结构。</p>
            </div>
            <div className="inline-flex self-start rounded-full bg-[#eef1ee] p-1" role="tablist" aria-label="文章输入方式">
              {([
                ["paste", "粘贴文章"],
                ["url", "导入 URL"],
                ...(IMAGE_OCR_ENABLED ? [["image", "图片阅读"]] : []),
              ] as [InputMode, string][]).map(([mode, label]) => (
                <button key={mode} className={`h-9 rounded-full px-3.5 text-sm font-medium transition-colors ${inputMode === mode ? "bg-[#183f34] text-white" : "text-[#53625b] hover:text-[#18211d]"}`} type="button" role="tab" aria-selected={inputMode === mode} onClick={() => setInputMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 sm:p-7">
            {inputMode === "paste" && (
              <div role="tabpanel">
                <label className="sr-only" htmlFor="article-text">英文文章内容</label>
                <ClearableField value={article} onClear={() => onArticleChange("")} label="清空粘贴文章" multiline>
                  <textarea id="article-text" ref={articleInputRef} className="min-h-[260px] w-full resize-y rounded-[14px] border border-[#cfd7d2] bg-[#f8faf8] p-5 text-[17px] leading-7 text-[#18211d] outline-none transition-colors placeholder:text-[#69766f] focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15 sm:min-h-[300px]" value={article} onChange={(event) => onArticleChange(event.target.value)} placeholder="Paste your English article here..." />
                </ClearableField>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-h-5 text-sm text-red-700" role="alert">{error}</p>
                  <div className="flex items-center justify-end gap-2">
                    <button className="inline-flex h-11 items-center gap-2 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#125b94]" type="button" onClick={onStartReading}>开始阅读 <ArrowIcon /></button>
                  </div>
                </div>
              </div>
            )}

            {inputMode === "url" && (
              <div className="mx-auto max-w-3xl py-8 sm:py-12" role="tabpanel">
                <h3 className="text-center text-2xl font-semibold tracking-[-0.025em]">把网页正文带进阅读工作台</h3>
                <p className="mx-auto mt-2 max-w-xl text-center text-sm leading-6 text-[#637169]">支持公开网页，尽量保留标题、段落、列表、引用、表格和正文图片，并略去广告与页面导航。</p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <label className="sr-only" htmlFor="article-url">文章 URL</label>
                  <ClearableField className="min-w-0 flex-1" value={articleUrl} onClear={() => onArticleUrlChange("")} label="清空文章网址">
                    <input id="article-url" className="h-12 w-full min-w-0 rounded-full border border-[#cfd7d2] bg-[#f8faf8] px-5 text-base text-[#18211d] outline-none placeholder:text-[#69766f] focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" value={articleUrl} onChange={(event) => onArticleUrlChange(event.target.value)} placeholder="https://example.com/article" type="url" onKeyDown={(event) => { if (event.key === "Enter") onImportUrl(); }} />
                  </ClearableField>
                  <button className="h-12 rounded-full bg-[#1769aa] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#125b94] disabled:bg-[#9ba7a1]" type="button" onClick={onImportUrl} disabled={importingUrl}>{importingUrl ? "正在读取并保存图片…" : "导入并阅读"}</button>
                </div>
                <p className="mt-3 min-h-5 text-center text-sm text-red-700" role="alert">{urlError}</p>
              </div>
            )}

            {inputMode === "image" && IMAGE_OCR_ENABLED && (
              <div className="mx-auto max-w-2xl py-8 text-center sm:py-12" role="tabpanel">
                <h3 className="text-2xl font-semibold tracking-[-0.025em]">让图片里的英文也能划词</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#637169]">适合截图、扫描图或不能复制文字的文章。上传后保留原图，并提取可交互文本。</p>
                <label className="mx-auto mt-7 inline-flex h-12 cursor-pointer items-center rounded-full bg-[#1769aa] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#125b94]">
                  <span>{ocrLoading ? "正在识别图片..." : "选择一张图片"}</span>
                  <input id="ocr-image" className="sr-only" type="file" accept="image/*" onChange={(event) => { onOcrImage(event.target.files?.[0] ?? null); event.target.value = ""; }} disabled={ocrLoading} />
                </label>
                <p className="mt-3 min-h-5 text-sm text-red-700" role="alert">{ocrError}</p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-2 lg:gap-12" aria-label="文章列表">
          <div>
            <div className="flex items-end justify-between gap-4 border-b border-[#18211d]/15 pb-4">
              <div><h2 className="text-2xl font-semibold tracking-[-0.025em]">马上试一篇</h2><p className="mt-1 text-sm text-[#637169]">公开文章已带入适合阅读的结构。</p></div>
              <span className="text-sm tabular-nums text-[#637169]">{initialPublicArticles.length} 篇</span>
            </div>
            {initialPublicArticles.length === 0 ? (
              <p className="py-8 text-sm text-[#637169]">暂无公开推荐文章，你可以先粘贴一篇自己的文章。</p>
            ) : (
              <ul className="divide-y divide-[#18211d]/10">
                {initialPublicArticles.slice(0, 4).map((publicArticle) => (
                  <li key={publicArticle.id}>
                    <button className="group flex w-full items-start justify-between gap-5 py-5 text-left disabled:cursor-wait disabled:opacity-60" type="button" onClick={() => onOpenPublicArticle(publicArticle.id)} disabled={Boolean(openingPublicArticleId)}>
                      <span className="min-w-0"><span className="block text-[15px] font-semibold leading-6 text-[#18211d] group-hover:text-[#1769aa]">{publicArticle.title}</span><span className="mt-1 line-clamp-2 block text-sm leading-6 text-[#637169]">{openingPublicArticleId === publicArticle.id ? "正在打开..." : publicArticle.summary || "适合语境查词的英文阅读文章"}</span></span>
                      <span className="mt-1 shrink-0 text-[#66736c] transition-transform group-hover:translate-x-1"><ArrowIcon /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-end justify-between gap-4 border-b border-[#18211d]/15 pb-4">
              <div><h2 className="text-2xl font-semibold tracking-[-0.025em]">继续上次阅读</h2><p className="mt-1 text-sm text-[#637169]">文章和阅读资料保存在当前浏览器。</p></div>
              <span className="text-sm tabular-nums text-[#637169]">{savedArticles.length} 篇</span>
            </div>
            {savedArticles.length === 0 ? (
              <div className="py-8"><p className="text-sm font-medium text-[#34443c]">还没有保存过文章</p><p className="mt-1 text-sm leading-6 text-[#637169]">进入阅读后保存一篇，它会出现在这里。</p></div>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-[#18211d]/10 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]">
                {savedArticles.map((savedArticle) => (
                  <li key={savedArticle.id} className="group relative py-5 pr-12">
                    <button type="button" className="block w-full text-left" onClick={() => onOpenSavedArticle(savedArticle)}>
                      <span className="block text-[15px] font-semibold leading-6 text-[#18211d] group-hover:text-[#1769aa]">{savedArticle.title || "未命名文章"}</span>
                      <span className="mt-1 line-clamp-2 block text-sm leading-6 text-[#637169]">{articleSummaryText(savedArticle)}</span>
                      <span className="mt-2 block text-xs text-[#7a867f]">{formatArticleDate(savedArticle.updatedAt)} 更新</span>
                    </button>
                    <button type="button" aria-label={`删除 ${savedArticle.title || "这篇文章"}`} className="absolute right-0 top-5 rounded-full px-2 py-1 text-xs text-[#7a5e58] opacity-70 transition-opacity hover:bg-[#f3e8e5] hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100" onClick={() => onDeleteSavedArticle(savedArticle.id)}>删除</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-16 border-y border-[#18211d]/12 py-10 sm:py-12" aria-labelledby="how-title">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
            <div><h2 id="how-title" className="text-3xl font-semibold tracking-[-0.03em]">查完这个词，文章还在眼前</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#637169]">Context Reader 把理解、保存和复习放在同一条阅读路径里。</p></div>
            <ol className="grid gap-7 sm:grid-cols-2">
              {[
                ["01", "带入文章", "粘贴文本、导入网页，或从图片中识别英文。"],
                ["02", "理解此处含义", "点击单词或划选短语，只看它在当前语境里的解释。"],
                ["03", "继续读下去", "解释就在阅读界面旁边，不用来回切换词典。"],
                ["04", "留下重要表达", "保存到生词本，之后导出 CSV 或送进 Anki。"],
              ].map(([number, title, copy]) => (
                <li key={number} className="flex gap-4"><span className="pt-0.5 font-mono text-xs text-[#2d765e]">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-[#637169]">{copy}</p></div></li>
              ))}
            </ol>
          </div>
        </section>

        <footer className="flex flex-col gap-4 pt-10 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">Context Reader</p><p className="mt-1 text-sm text-[#637169]">为英文新闻、博客、论文和长文精读准备。</p></div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#53625b]">
            <span>本地保存</span><span>语境解释</span><span>全文翻译</span><span>Anki 导入</span>
            <Link className="font-medium text-[#1769aa] underline-offset-4 hover:underline" href="/guide#anki-setup">查看 Anki 设置</Link>
          </div>
        </footer>
      </div>

      <VocabularyPanel
        entries={vocabularyEntries}
        open={vocabularyOpen}
        importingId=""
        importError={vocabularyError}
        placement="dialog"
        showAnkiActions={false}
        onClose={() => setVocabularyOpen(false)}
        onDelete={(id) => setVocabularyEntries(deleteVocabularyEntry(id))}
        onClear={handleClearVocabulary}
        onExportCsv={handleExportVocabularyCsv}
        onCopy={handleCopyVocabularyEntry}
        onJumpToSource={onJumpToVocabularySource}
        canJumpToSource={canJumpToVocabularySource}
        onImportAnki={() => undefined}
        onImportAllAnki={() => undefined}
      />
    </main>
  );
}
