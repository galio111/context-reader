"use client";

interface ArticleInputProps {
  article: string;
  error: string;
  onArticleChange: (article: string) => void;
  onStartReading: () => void;
}

export function ArticleInput({
  article,
  error,
  onArticleChange,
  onStartReading,
}: ArticleInputProps) {
  return (
    <main className="min-h-screen bg-white px-4 py-10">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col justify-center">
        <div className="mb-8 text-center">
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
      </section>
    </main>
  );
}
