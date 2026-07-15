"use client";

import { useEffect, useMemo, useState } from "react";
import AdminAccountsPanel from "@/components/AdminAccountsPanel";
import AdminArticleIntakePanel from "@/components/AdminArticleIntakePanel";
import { getSavedArticles } from "@/lib/articles";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import {
  createArticleTranslationCacheKey,
  getCachedArticleTranslationForBlocks,
  getArticleTranslationCacheEntries,
  getExplanationCacheEntries,
} from "@/lib/cache";
import type { SavedArticle } from "@/types/article";
import type { PublicArticle, PublicArticleTranslation, PublicExplanation } from "@/types/publicArticle";

function explanationWordFromKey(cacheKey: string): string {
  return cacheKey.split("::")[0] || "";
}

function explanationSentenceFromKey(cacheKey: string): string {
  return cacheKey.split("::").slice(1).join("::");
}

function explanationsForArticle(article: SavedArticle): PublicExplanation[] {
  const bodyKey = article.body.toLowerCase();
  return getExplanationCacheEntries()
    .filter(({ cacheKey, explanation }) => {
      const sentence = explanationSentenceFromKey(cacheKey);
      return sentence && bodyKey.includes(sentence.trim().toLowerCase());
    })
    .map(({ cacheKey, explanation }) => ({
      cacheKey,
      word: explanation.word || explanationWordFromKey(cacheKey),
      sentence: explanationSentenceFromKey(cacheKey),
      explanation,
    }));
}

function articleTranslationsForArticle(article: SavedArticle): PublicArticleTranslation[] {
  const blocks = createArticleTranslationBlocks(article.body, article.importedArticle);
  const cacheKey = createArticleTranslationCacheKey(blocks);
  const cached = getArticleTranslationCacheEntries().find((item) => item.cacheKey === cacheKey);
  if (cached) {
    return [{ cacheKey: cached.cacheKey, translations: cached.translations }];
  }

  const blockTranslations = getCachedArticleTranslationForBlocks(blocks);
  const translatedIds = new Set(blockTranslations.map((item) => item.id));
  return blocks.length > 0 && blocks.every((block) => translatedIds.has(block.id))
    ? [{ cacheKey, translations: blockTranslations }]
    : [];
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeSection, setActiveSection] = useState<"articles" | "accounts">("articles");
  const [loginError, setLoginError] = useState("");
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [publishingId, setPublishingId] = useState("");
  const [batchPublishing, setBatchPublishing] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [status, setStatus] = useState("");
  const [publishedArticle, setPublishedArticle] = useState<PublicArticle | null>(null);
  const [publicArticles, setPublicArticles] = useState<PublicArticle[]>([]);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "accounts") setActiveSection("accounts");
  }, []);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/admin/session");
        const data = (await response.json()) as { authenticated?: boolean };
        setAuthenticated(Boolean(data.authenticated));
      } finally {
        setCheckingSession(false);
      }
    }

    void checkSession();
  }, []);

  function selectSection(section: "articles" | "accounts") {
    setActiveSection(section);
    const url = section === "accounts" ? "/admin?section=accounts" : "/admin";
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    if (authenticated) {
      setArticles(getSavedArticles());
      void loadPublicArticles();
    }
  }, [authenticated]);

  useEffect(() => {
    setSelectedArticleIds((ids) => ids.filter((id) => articles.some((article) => article.id === id)));
  }, [articles]);

  async function loadPublicArticles() {
    const response = await fetch("/api/admin/public-articles");
    const data = (await response.json().catch(() => null)) as { articles?: PublicArticle[]; error?: string } | null;
    if (!response.ok) {
      setStatus(data?.error || "公开文章列表读取失败。");
      return;
    }
    setPublicArticles(data?.articles ?? []);
  }

  function publicArticleKey(article: Pick<PublicArticle, "title" | "summary" | "sourceUrl">): string {
    return `${article.title.trim()}::${article.summary.trim()}::${article.sourceUrl.trim()}`;
  }

  function savedArticleKey(article: SavedArticle): string {
    return `${article.title.trim()}::${(article.summary || "推荐英文阅读文章").trim()}::${(article.importedArticle?.url || "").trim()}`;
  }

  function isPublished(article: SavedArticle): boolean {
    const key = savedArticleKey(article);
    return publicArticles.some((item) => publicArticleKey(item) === key);
  }

  function toggleSelectedArticle(id: string): void {
    setSelectedArticleIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  }

  function selectPublishedArticles(): void {
    setSelectedArticleIds(articles.filter((article) => isPublished(article)).map((article) => article.id));
  }

  const articleStats = useMemo(
    () =>
      new Map(
        articles.map((article) => [
          article.id,
          {
            explanations: explanationsForArticle(article).length,
            articleTranslations: articleTranslationsForArticle(article).length,
          },
        ]),
      ),
    [articles],
  );

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setLoginError(data?.error || "登录失败。");
      return;
    }
    setPassword("");
    setShowPassword(false);
    setAuthenticated(true);
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setArticles([]);
    setPublicArticles([]);
    setSelectedArticleIds([]);
    setStatus("");
    setPublishedArticle(null);
    setPublishingId("");
    setDeletingId("");
    setPassword("");
    setShowPassword(false);
  }

  async function handlePublish(article: SavedArticle) {
    const existingPublicArticle = publicArticles.find((item) => publicArticleKey(item) === savedArticleKey(article));
    if (!existingPublicArticle) {
      setStatus("新的推荐文章必须先通过上方的候选流程补齐分类和封面。");
      return;
    }
    if (!existingPublicArticle.recommendation?.coverImageUrl?.trim()) {
      setStatus("这篇公开文章还缺少推荐封面，请通过上方 URL 或粘贴入口重新整理并补充封面。");
      return;
    }
    setPublishingId(article.id);
    setStatus("");
    setPublishedArticle(null);

    const explanations = explanationsForArticle(article);
    const articleTranslations = articleTranslationsForArticle(article);
    const response = await fetch("/api/admin/public-articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: article.title,
        summary: article.summary || "推荐英文阅读文章",
        body: article.body,
        sourceUrl: article.importedArticle?.url || "",
        sourceName: article.importedArticle?.siteName || "",
        importedArticle: article.importedArticle ?? null,
        recommendation: existingPublicArticle.recommendation,
        explanations,
        articleTranslations,
      }),
    });
    const data = (await response.json().catch(() => null)) as { article?: PublicArticle; error?: string } | null;

    if (!response.ok || !data?.article) {
      setStatus(data?.error || "发布失败。请检查数据库环境变量。");
      setPublishingId("");
      return;
    }

    setPublishedArticle(data.article);
    setStatus(
      `已发布或更新《${data.article.title}》，包含 ${data.article.explanations?.length ?? 0} 条预缓存解释，${data.article.articleTranslations?.length ?? 0} 份全文翻译缓存。`,
    );
    await loadPublicArticles();
    setPublishingId("");
  }

  async function handleBatchPublish() {
    const selectedArticles = articles.filter((article) => selectedArticleIds.includes(article.id));
    if (selectedArticles.length === 0) {
      setStatus("请先勾选要发布的文章。");
      return;
    }

    setBatchPublishing(true);
    setStatus(`正在批量发布 ${selectedArticles.length} 篇文章...`);

    let successCount = 0;
    for (const article of selectedArticles) {
      setPublishingId(article.id);
      const explanations = explanationsForArticle(article);
      const articleTranslations = articleTranslationsForArticle(article);
      const existingPublicArticle = publicArticles.find((item) => publicArticleKey(item) === savedArticleKey(article));
      if (!existingPublicArticle?.recommendation?.coverImageUrl?.trim()) {
        setStatus(`批量更新中断：《${article.title}》尚未补齐推荐封面。`);
        setPublishingId("");
        setBatchPublishing(false);
        return;
      }
      const response = await fetch("/api/admin/public-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: article.title,
          summary: article.summary || "推荐英文阅读文章",
          body: article.body,
          sourceUrl: article.importedArticle?.url || "",
          sourceName: article.importedArticle?.siteName || "",
          importedArticle: article.importedArticle ?? null,
          recommendation: existingPublicArticle.recommendation,
          explanations,
          articleTranslations,
        }),
      });

      if (response.ok) {
        successCount += 1;
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus(`批量发布中断：${data?.error || "发布失败。"}`);
        setPublishingId("");
        setBatchPublishing(false);
        await loadPublicArticles();
        return;
      }
    }

    setPublishingId("");
    setBatchPublishing(false);
    setStatus(`批量发布完成：${successCount} 篇文章已发布。`);
    setSelectedArticleIds([]);
    await loadPublicArticles();
  }

  async function handleDeletePublicArticle(article: PublicArticle) {
    if (!window.confirm(`确定要删除公开推荐《${article.title}》吗？`)) {
      return;
    }

    setDeletingId(article.id);
    setStatus("");
    const response = await fetch(`/api/admin/public-articles?id=${encodeURIComponent(article.id)}`, {
      method: "DELETE",
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setStatus(data?.error || "删除失败。");
      setDeletingId("");
      return;
    }

    setStatus(`已删除公开推荐《${article.title}》。`);
    setPublicArticles((items) => items.filter((item) => item.id !== article.id));
    setDeletingId("");
  }

  if (checkingSession) {
    return (
      <main className="min-h-screen bg-[#f5f5f7] px-4 py-8 text-[#1d1d1f]">
        <section className="mx-auto max-w-xl rounded-[18px] bg-white p-5">正在检查管理员状态...</section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-[#f5f5f7] px-4 py-8 text-[#1d1d1f]">
        <form className="mx-auto max-w-xl rounded-[18px] bg-white p-5" onSubmit={handleLogin}>
          <h1 className="text-[28px] font-semibold leading-tight">管理员入口</h1>
          <p className="mt-2 text-sm leading-6 text-[#333333]">
            登录后可以管理公开推荐文章、用户账号、套餐和用量。
          </p>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-semibold text-[#333333]">管理员密码</span>
            <span className="relative block">
              <input
                className="h-11 w-full rounded-full border border-black/10 px-5 pr-20 text-[17px] outline-none focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                className="absolute inset-y-0 right-1 my-auto h-9 rounded-full px-3 text-sm font-medium text-[#0066cc] hover:bg-[#f2f7fc] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? "隐藏管理员密码" : "显示管理员密码"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </span>
          </label>
          {loginError && <p className="mt-3 text-sm text-red-600">{loginError}</p>}
          <button className="mt-5 h-11 rounded-full bg-[#0066cc] px-6 text-[17px] text-white" type="submit">
            登录
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 text-[#1d1d1f]">
      <section className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[32px] font-semibold leading-tight">Context Reader 管理后台</h1>
            <p className="mt-1 text-sm leading-6 text-[#333333]">
              在一个后台管理公开内容、用户账号、套餐和 AI 用量。
            </p>
          </div>
          <button
            className="h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc]"
            type="button"
            onClick={handleLogout}
          >
            退出
          </button>
        </header>

        <nav className="mt-5 flex w-fit gap-1 rounded-full bg-white p-1" aria-label="后台功能">
          <button
            className={`h-10 rounded-full px-5 text-sm font-medium transition-colors ${
              activeSection === "articles" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "articles" ? "page" : undefined}
            onClick={() => selectSection("articles")}
          >
            推荐文章
          </button>
          <button
            className={`h-10 rounded-full px-5 text-sm font-medium transition-colors ${
              activeSection === "accounts" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "accounts" ? "page" : undefined}
            onClick={() => selectSection("accounts")}
          >
            账号与用量
          </button>
        </nav>

        {activeSection === "accounts" ? (
          <div className="mt-6">
            <AdminAccountsPanel />
          </div>
        ) : (
          <>

        {status && (
          <p className="mt-5 rounded-[16px] border border-[#d2d2d7] bg-white p-4 text-sm leading-6 text-[#333333]">
            {status}
            {publishedArticle && (
              <span className="mt-1 block text-[#0066cc]">公开文章 ID：{publishedArticle.id}</span>
            )}
          </p>
        )}

        <div className="mt-6">
          <AdminArticleIntakePanel onPublished={loadPublicArticles} />
        </div>

        <section className="mt-6 rounded-2xl bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[21px] font-semibold">已公开推荐</h2>
              <p className="mt-1 text-sm leading-6 text-[#333333]">
                当前首页会显示这些公开文章。删除后访客将无法再从推荐列表打开。
              </p>
            </div>
            <button
              className="h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc]"
              type="button"
              onClick={() => void loadPublicArticles()}
            >
              刷新
            </button>
          </div>
          {publicArticles.length === 0 ? (
            <p className="mt-4 text-sm leading-6 text-[#7a7a7a]">还没有公开推荐文章。</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {publicArticles.map((article) => (
                <li key={article.id} className="flex flex-col gap-3 rounded-[16px] border border-[#e0e0e0] p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold leading-6">{article.title}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${article.recommendation?.coverImageUrl ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {article.recommendation?.coverImageUrl ? "封面已准备" : "缺少封面"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#333333]">{article.summary || "暂无摘要"}</p>
                    <p className="mt-1 break-all text-xs leading-5 text-[#7a7a7a]">ID：{article.id}</p>
                  </div>
                  <button
                    className="h-9 shrink-0 rounded-full border border-red-200 px-4 text-sm text-red-600 disabled:text-[#7a7a7a]"
                    type="button"
                    disabled={deletingId === article.id}
                    onClick={() => handleDeletePublicArticle(article)}
                  >
                    {deletingId === article.id ? "删除中..." : "删除公开"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {articles.length === 0 ? (
          <section className="mt-6 rounded-[18px] bg-white p-5">
            <h2 className="text-[21px] font-semibold">还没有本地保存文章</h2>
            <p className="mt-2 text-sm leading-6 text-[#333333]">
              回到首页保存文章后，再来这里发布为公开推荐文章。
            </p>
          </section>
        ) : (
          <>
          <section className="mt-6 flex flex-col gap-3 rounded-[18px] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[21px] font-semibold">本地保存文章</h2>
              <p className="mt-1 text-sm leading-6 text-[#333333]">
                这里用于更新已公开文章的解释与全文翻译缓存；新的推荐文章请先通过候选流程补齐封面。
              </p>
            </div>
            <button
              className="h-10 self-start rounded-full bg-[#0066cc] px-5 text-sm text-white disabled:bg-[#d2d2d7]"
              type="button"
              disabled={batchPublishing || selectedArticleIds.length === 0}
              onClick={handleBatchPublish}
            >
              {batchPublishing ? "批量更新中..." : `更新选中预缓存 (${selectedArticleIds.length})`}
            </button>
          </section>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc]"
              type="button"
              onClick={selectPublishedArticles}
            >
              选择已公开
            </button>
            <button
              className="h-9 rounded-full border border-[#e0e0e0] px-4 text-sm text-[#333333]"
              type="button"
              onClick={() => setSelectedArticleIds([])}
            >
              清空选择
            </button>
          </div>
          <ul className="mt-4 grid gap-4">
            {articles.map((article) => {
              const stats = articleStats.get(article.id);
              const published = isPublished(article);
              const selected = selectedArticleIds.includes(article.id);
              return (
                <li key={article.id} className="rounded-[18px] bg-white p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <label className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        className="mt-1 h-5 w-5 accent-[#0066cc]"
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelectedArticle(article.id)}
                        disabled={batchPublishing}
                      />
                      <span className="sr-only">选择 {article.title}</span>
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[21px] font-semibold leading-snug">{article.title}</h2>
                        {published && (
                          <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-medium text-[#0066cc]">
                            已公开
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#333333]">{article.summary || "暂无摘要"}</p>
                      <p className="mt-2 text-xs leading-5 text-[#7a7a7a]">
                        {article.body.length} 字符，{stats?.explanations ?? 0} 条可发布的预缓存解释，{stats?.articleTranslations ?? 0} 份全文翻译缓存
                      </p>
                    </div>
                    <button
                      className="h-10 shrink-0 rounded-full bg-[#0066cc] px-5 text-sm text-white disabled:bg-[#d2d2d7]"
                      type="button"
                      disabled={publishingId === article.id || batchPublishing || !published}
                      onClick={() => handlePublish(article)}
                    >
                      {publishingId === article.id ? "更新中..." : published ? "更新预缓存" : "请先加入候选"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
          </>
        )}
      </section>
    </main>
  );
}
