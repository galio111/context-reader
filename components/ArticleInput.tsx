"use client";

import type { SavedArticle } from "@/types/article";

interface ArticleInputProps {
  article: string;
  error: string;
  savedArticles: SavedArticle[];
  onArticleChange: (article: string) => void;
  onStartReading: () => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onDeleteSavedArticle: (id: string) => void;
}

export function ArticleInput({
  article,
  error,
  savedArticles,
  onArticleChange,
  onStartReading,
  onOpenSavedArticle,
  onDeleteSavedArticle,
}: ArticleInputProps) {
  return (
    <main className="min-h-screen bg-white px-4 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col justify-center">
          <div className="mb-8 text-center lg:text-left">
            <h1 className="text-4xl font-semibold tracking-normal text-gray-950">Context Reader</h1>
            <p className="mt-3 text-base text-gray-600">
              Paste an English article and click any word to see its meaning in context.
            </p>
          </div>

          <textarea
            className="min-h-[360px] w-full resize-y rounded-md border border-gray-300 bg-white p-5 text-lg leading-8 text-gray-900 shadow-sm outline-none transition focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
            value={article}
            onChange={(event) => onArticleChange(event.target.value)}
            placeholder="Paste your English article here..."
          />

          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="min-h-6 text-sm text-red-600" role="alert">
              {error}
            </p>
            <button
              className="rounded-md bg-gray-950 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
              type="button"
              onClick={onStartReading}
            >
              开始阅读
            </button>
          </div>
        </div>

        <aside className="rounded-md border border-gray-200 bg-slate-50 p-4">
          <h2 className="text-lg font-semibold text-gray-950">已保存文章</h2>
          <p className="mt-1 text-sm text-gray-500">点击文章可直接进入阅读。</p>

          {savedArticles.length === 0 ? (
            <p className="mt-5 text-sm leading-6 text-gray-500">还没有保存过文章。</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {savedArticles.map((savedArticle) => (
                <li key={savedArticle.id} className="rounded-md border border-gray-200 bg-white p-3">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onOpenSavedArticle(savedArticle)}
                  >
                    <span className="block text-sm font-semibold leading-6 text-gray-950">
                      {savedArticle.title}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      {new Date(savedArticle.updatedAt).toLocaleString()}
                    </span>
                    <span className="mt-2 line-clamp-3 block text-sm leading-6 text-gray-600">
                      {savedArticle.body}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mt-3 text-xs font-medium text-red-600 hover:text-red-700"
                    onClick={() => onDeleteSavedArticle(savedArticle.id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </section>
    </main>
  );
}
