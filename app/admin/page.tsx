"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AdminAccountsPanel from "@/components/AdminAccountsPanel";
import ClearableField from "@/components/ClearableField";
import AdminArticleIntakePanel from "@/components/AdminArticleIntakePanel";
import AdminArticleMetadataInspector from "@/components/AdminArticleMetadataInspector";
import AdminHomepageCurationPanel from "@/components/AdminHomepageCurationPanel";
import AdminFeedbackPanel from "@/components/AdminFeedbackPanel";
import AdminErrorReportsPanel from "@/components/AdminErrorReportsPanel";
import { ReaderView } from "@/components/ReaderView";
import { SiteBackdrop } from "@/components/SiteBackdrop";
import { getSavedArticles } from "@/lib/articles";
import { countArticleEnglishWords } from "@/lib/articleWordCount";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import {
  createArticleTranslationCacheKey,
  getCachedArticleTranslationForBlocks,
  getArticleTranslationCacheEntries,
  getExplanationCacheEntries,
  setCachedArticleTranslation,
} from "@/lib/cache";
import type { ImportedArticle, SavedArticle } from "@/types/article";
import type { ArticleRecommendationMetadata, PublicArticle, PublicArticleTranslation, PublicExplanation } from "@/types/publicArticle";
import { editorialCategoryForRecommendation, type EditorialCategory } from "@/lib/editorialCuration";

type AdminAccessMode = "developer" | "password" | null;
type AdminReaderState = { kind: "candidate" | "published"; article: PublicArticle };

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
  const [accessMode, setAccessMode] = useState<AdminAccessMode>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeSection, setActiveSection] = useState<"articles" | "accounts" | "feedback" | "errors">("articles");
  const [loginError, setLoginError] = useState("");
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [publishingId, setPublishingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [status, setStatus] = useState("");
  const [publishedArticle, setPublishedArticle] = useState<PublicArticle | null>(null);
  const [publicArticles, setPublicArticles] = useState<PublicArticle[]>([]);
  const [readerState, setReaderState] = useState<AdminReaderState | null>(null);
  const pendingSavedReaderArticleRef = useRef<PublicArticle | null>(null);
  const [candidateArticles, setCandidateArticles] = useState<PublicArticle[]>([]);
  const [rejectedArticles, setRejectedArticles] = useState<PublicArticle[]>([]);
  const [editorialDrawer, setEditorialDrawer] = useState<"candidates" | "published" | null>(null);
  const [editorialSearch, setEditorialSearch] = useState("");
  const [editorialDifficulty, setEditorialDifficulty] = useState("");
  const [editorialCategory, setEditorialCategory] = useState("");
  const [quickUrl, setQuickUrl] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);
  const [openingArticleId, setOpeningArticleId] = useState("");
  const publicArticlesRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-context-theme");
    const previousColorScheme = root.style.colorScheme;
    const keepAdminLight = () => {
      if (root.getAttribute("data-context-theme") !== "day") root.setAttribute("data-context-theme", "day");
      if (root.style.colorScheme !== "light") root.style.colorScheme = "light";
    };
    keepAdminLight();
    const observer = new MutationObserver(keepAdminLight);
    observer.observe(root, { attributes: true, attributeFilter: ["data-context-theme"] });
    return () => {
      observer.disconnect();
      if (previousTheme) root.setAttribute("data-context-theme", previousTheme);
      else root.removeAttribute("data-context-theme");
      root.style.colorScheme = previousColorScheme;
    };
  }, []);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "accounts") setActiveSection("accounts");
    if (section === "feedback") setActiveSection("feedback");
    if (section === "errors") setActiveSection("errors");
  }, []);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/admin/session");
        const data = (await response.json()) as { authenticated?: boolean; accessMode?: AdminAccessMode };
        setAuthenticated(Boolean(data.authenticated));
        setAccessMode(data.accessMode ?? null);
      } finally {
        setCheckingSession(false);
      }
    }

    void checkSession();
  }, []);

  function selectSection(section: "articles" | "accounts" | "feedback" | "errors") {
    setActiveSection(section);
    const url = section === "articles" ? "/admin" : `/admin?section=${section}`;
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    if (authenticated) {
      setArticles(getSavedArticles());
      void Promise.all([loadPublicArticles({ silent: true }), loadCandidateArticles({ silent: true })]);
    }
  }, [authenticated]);

  async function loadPublicArticles(options?: { silent?: boolean }) {
    const response = await fetch("/api/admin/public-articles");
    const data = (await response.json().catch(() => null)) as { articles?: PublicArticle[]; error?: string } | null;
    if (!response.ok) {
      if (!options?.silent) {
        setStatus(data?.error || "公开文章列表读取失败。");
      }
      return;
    }
    setPublicArticles(data?.articles ?? []);
  }

  async function loadCandidateArticles(options?: { silent?: boolean }): Promise<PublicArticle[]> {
    const response = await fetch("/api/admin/article-candidates", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { articles?: PublicArticle[]; rejectedArticles?: PublicArticle[]; error?: string } | null;
    if (!response.ok) {
      if (!options?.silent) setStatus(data?.error || "候选文章列表读取失败。");
      return [];
    }
    const next = data?.articles ?? [];
    setCandidateArticles(next);
    setRejectedArticles(data?.rejectedArticles ?? []);
    return next;
  }

  function openCandidateArticle(article: PublicArticle) {
    setStatus("");
    setEditorialDrawer(null);
    setCandidateArticles((items) => items.some((item) => item.id === article.id) ? items : [article, ...items]);
    setReaderState({ kind: "candidate", article });
  }

  async function openPublishedArticle(article: PublicArticle) {
    if (openingArticleId) return;
    setOpeningArticleId(article.id);
    setStatus("");
    try {
      const response = await fetch(`/api/public-articles/${encodeURIComponent(article.id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
      if (!response.ok || !data?.article?.body?.trim()) {
        throw new Error(data?.error || "公开文章读取失败，请稍后重试。");
      }
      for (const translation of data.article.articleTranslations ?? []) {
        setCachedArticleTranslation(translation.cacheKey, translation.translations);
      }
      setReaderState({ kind: "published", article: data.article });
      setEditorialDrawer(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "公开文章读取失败，请稍后重试。");
    } finally {
      setOpeningArticleId("");
    }
  }

  async function persistReaderArticleEdit(body: string, importedArticle: ImportedArticle | null) {
    const active = readerState;
    if (!active) return;
    const currentRecommendation = active.article.recommendation ?? active.article.importedArticle?.recommendation;
    const recommendation = currentRecommendation
      ? {
          ...currentRecommendation,
          wordCount: countArticleEnglishWords(body),
          difficultyEvidence: undefined,
          classifiedAt: undefined,
        }
      : undefined;
    const nextImportedArticle = importedArticle
      ? {
          ...importedArticle,
          title: active.article.title,
          text: body,
          ...(recommendation ? { recommendation } : {}),
        }
      : null;
    const payload = {
      id: active.article.id,
      title: active.article.title,
      summary: active.article.summary,
      body,
      sourceUrl: active.article.sourceUrl,
      sourceName: active.article.sourceName,
      importedArticle: nextImportedArticle,
      ...(recommendation ? { recommendation } : {}),
    };
    const response = await fetch(
      active.kind === "candidate" ? "/api/admin/article-candidates" : "/api/admin/public-articles",
      {
        method: active.kind === "candidate" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
    if (!response.ok || !data?.article) {
      throw new Error(data?.error || "文章修改保存失败，请重试。");
    }
    pendingSavedReaderArticleRef.current = data.article;
    if (active.kind === "candidate") {
      setCandidateArticles((items) => items.map((item) => item.id === data.article?.id ? data.article : item));
    }
    if (active.kind === "published") {
      setPublicArticles((items) => items.map((item) => item.id === data.article?.id ? data.article : item));
    }
  }

  async function persistReaderMetadata(summary: string, recommendation: ArticleRecommendationMetadata) {
    const active = readerState;
    if (!active) return;
    const importedArticle = active.article.importedArticle
      ? {
          ...active.article.importedArticle,
          title: active.article.title,
          text: active.article.body,
          recommendation,
        }
      : null;
    const payload = {
      id: active.article.id,
      title: active.article.title,
      summary,
      body: active.article.body,
      sourceUrl: active.article.sourceUrl,
      sourceName: active.article.sourceName,
      importedArticle,
      recommendation,
    };
    const response = await fetch(
      active.kind === "candidate" ? "/api/admin/article-candidates" : "/api/admin/public-articles",
      {
        method: active.kind === "candidate" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
    if (!response.ok || !data?.article) {
      throw new Error(data?.error || "文章资料保存失败，请重试。");
    }
    setReaderState({ kind: active.kind, article: data.article });
    if (active.kind === "candidate") {
      setCandidateArticles((items) => items.map((item) => item.id === data.article?.id ? data.article : item));
    }
    if (active.kind === "published") {
      setPublicArticles((items) => items.map((item) => item.id === data.article?.id ? data.article : item));
    }
  }

  function adjacentArticle(direction: -1 | 1): PublicArticle | null {
    if (!readerState) return null;
    const queue = readerState.kind === "candidate" ? candidateArticles : publicArticles;
    const index = queue.findIndex((item) => item.id === readerState.article.id);
    return index >= 0 ? queue[index + direction] ?? null : null;
  }

  async function openAdjacentArticle(direction: -1 | 1) {
    const article = adjacentArticle(direction);
    if (!article || !readerState) return;
    if (readerState.kind === "candidate") openCandidateArticle(article);
    else await openPublishedArticle(article);
  }

  function continueCandidateQueue(completedId: string, nextQueue: PublicArticle[]) {
    const previousIndex = candidateArticles.findIndex((item) => item.id === completedId);
    const next = nextQueue[Math.min(Math.max(0, previousIndex), Math.max(0, nextQueue.length - 1))];
    if (next) setReaderState({ kind: "candidate", article: next });
    else setReaderState(null);
  }

  async function selectCurrentCandidate(category: EditorialCategory, options: {
    categoryFeatured: boolean;
    includeInRecommendation: boolean;
    recommendationFeatured: boolean;
  }) {
    const active = readerState;
    if (!active || active.kind !== "candidate") return;
    const response = await fetch("/api/admin/article-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish",
        id: active.article.id,
        category,
        featured: options.categoryFeatured,
        includeInRecommendation: options.includeInRecommendation,
        recommendationFeatured: options.recommendationFeatured,
      }),
    });
    const data = await response.json().catch(() => null) as { articles?: PublicArticle[]; error?: string } | null;
    if (!data?.articles?.[0]) throw new Error(data?.error || "精选失败。");
    const published = data.articles[0];
    const nextQueue = candidateArticles.filter((item) => item.id !== active.article.id);
    setCandidateArticles(nextQueue);
    setPublicArticles((items) => [published, ...items.filter((item) => item.id !== published.id)]);
    setStatus(response.ok
      ? `已精选《${published.title}》并加入“${category}”${options.categoryFeatured ? "主推" : "栏目"}${options.includeInRecommendation ? "，同时进入推荐候选池" : ""}${options.recommendationFeatured ? "并设为推荐主推" : ""}。`
      : `《${published.title}》已经公开，但首页编排更新失败：${data.error || "请在栏目微调中补充"}`);
    continueCandidateQueue(active.article.id, nextQueue);
  }

  async function rejectCurrentCandidate() {
    const active = readerState;
    if (!active || active.kind !== "candidate") return;
    const response = await fetch("/api/admin/article-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: active.article.id }),
    });
    const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
    if (!response.ok || !data?.article) throw new Error(data?.error || "移出候选失败。");
    const nextQueue = candidateArticles.filter((item) => item.id !== active.article.id);
    setCandidateArticles(nextQueue);
    setRejectedArticles((items) => [data.article!, ...items.filter((item) => item.id !== data.article?.id)]);
    setStatus(`《${active.article.title}》已移出候选，可在候选列表的“不精选记录”中撤销。`);
    continueCandidateQueue(active.article.id, nextQueue);
  }

  async function restoreRejectedArticle(article: PublicArticle) {
    const response = await fetch("/api/admin/article-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", id: article.id }),
    });
    const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
    if (!response.ok || !data?.article) {
      setStatus(data?.error || "恢复候选失败。");
      return;
    }
    setRejectedArticles((items) => items.filter((item) => item.id !== article.id));
    setCandidateArticles((items) => [data.article!, ...items.filter((item) => item.id !== article.id)]);
  }

  async function handleQuickAddUrl(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickUrl.trim() || quickAdding) return;
    setQuickAdding(true);
    setStatus("");
    try {
      const importResponse = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: quickUrl.trim() }),
      });
      const imported = await importResponse.json().catch(() => null) as { article?: ImportedArticle; metadata?: { description?: string; coverCandidates?: string[] }; error?: string } | null;
      if (!importResponse.ok || !imported?.article?.text?.trim()) throw new Error(imported?.error || "网址文章读取失败。");
      const classificationResponse = await fetch("/api/admin/article-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: imported.article.title, text: imported.article.text, sourceUrl: imported.article.url, sourceName: imported.article.siteName }),
      });
      const classificationData = await classificationResponse.json().catch(() => null) as { classification?: Omit<ArticleRecommendationMetadata, "coverImageUrl" | "sourceKind"> & { summary?: string }; error?: string } | null;
      if (!classificationResponse.ok || !classificationData?.classification) throw new Error(classificationData?.error || "文章分类失败。");
      const classification = classificationData.classification;
      const recommendation: ArticleRecommendationMetadata = {
        coverImageUrl: imported.metadata?.coverCandidates?.[0] ?? "",
        coverImageAlt: imported.article.title,
        coverImageSourceUrl: imported.article.url,
        difficulty: classification.difficulty,
        cefr: classification.cefr,
        audienceStages: classification.audienceStages,
        topics: classification.topics,
        homepageCategory: classification.homepageCategory ?? editorialCategoryForRecommendation(classification as ArticleRecommendationMetadata),
        wordCount: classification.wordCount,
        timeliness: classification.timeliness,
        sourceKind: "manual-url",
        classificationSource: classification.classificationSource,
        classifiedAt: classification.classifiedAt,
        reviewNotes: classification.reviewNotes,
        difficultyEvidence: classification.difficultyEvidence,
      };
      const saveResponse = await fetch("/api/admin/article-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: imported.article.title,
          summary: classification.summary || imported.metadata?.description || "",
          body: imported.article.text,
          sourceUrl: imported.article.url,
          sourceName: imported.article.siteName,
          importedArticle: { ...imported.article, recommendation },
          recommendation,
        }),
      });
      const saved = await saveResponse.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
      if (!saveResponse.ok || !saved?.article) throw new Error(saved?.error || "候选文章保存失败。");
      setCandidateArticles((items) => [saved.article!, ...items.filter((item) => item.id !== saved.article?.id)]);
      setQuickUrl("");
      setStatus(`已自动提取并分类《${saved.article.title}》，现在进入审稿。`);
      openCandidateArticle(saved.article);
    } catch (quickError) {
      setStatus(quickError instanceof Error ? quickError.message : "增加候选失败。");
    } finally {
      setQuickAdding(false);
    }
  }

  function normalizeArticleIdentityText(value: string): string {
    return value
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findMatchingSavedArticle(article: PublicArticle): SavedArticle | undefined {
    const sourceUrl = normalizeArticleIdentityText(article.sourceUrl);
    const body = normalizeArticleIdentityText(article.body);

    return articles.find((savedArticle) => {
      const savedSourceUrl = normalizeArticleIdentityText(savedArticle.importedArticle?.url || "");
      if (sourceUrl && savedSourceUrl && sourceUrl === savedSourceUrl) {
        return true;
      }

      const savedBody = normalizeArticleIdentityText(savedArticle.body);
      return Boolean(body && savedBody && body === savedBody);
    });
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
    setAccessMode("password");
  }

  async function handleLogout() {
    if (accessMode === "developer") {
      window.location.href = "/";
      return;
    }
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setAccessMode(null);
    setArticles([]);
    setPublicArticles([]);
    setStatus("");
    setPublishedArticle(null);
    setPublishingId("");
    setDeletingId("");
    setPassword("");
    setShowPassword(false);
  }

  async function handlePublish(article: SavedArticle) {
    const existingPublicArticle = publicArticles.find((item) => findMatchingSavedArticle(item)?.id === article.id);
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

  async function handleDeletePublicArticle(article: PublicArticle): Promise<boolean> {
    if (!window.confirm(`确定要删除公开推荐《${article.title}》吗？`)) {
      return false;
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
      return false;
    }

    setStatus(`已删除公开推荐《${article.title}》。`);
    setPublicArticles((items) => items.filter((item) => item.id !== article.id));
    setDeletingId("");
    return true;
  }

  async function deleteCurrentPublishedArticle() {
    const active = readerState;
    if (!active || active.kind !== "published") return;
    const currentIndex = publicArticles.findIndex((item) => item.id === active.article.id);
    if (!(await handleDeletePublicArticle(active.article))) return;
    const nextQueue = publicArticles.filter((item) => item.id !== active.article.id);
    const next = nextQueue[Math.min(Math.max(0, currentIndex), Math.max(0, nextQueue.length - 1))];
    if (next) await openPublishedArticle(next);
    else setReaderState(null);
  }

  if (checkingSession) {
    return (
      <main className="cr-site-background px-4 py-8 text-[#17212b]">
        <SiteBackdrop />
        <section className="mx-auto max-w-xl rounded-[18px] bg-white p-5">正在检查管理员状态...</section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="cr-site-background px-4 py-8 text-[#17212b]">
        <SiteBackdrop />
        <form className="mx-auto max-w-xl rounded-[18px] bg-white p-5" onSubmit={handleLogin}>
          <h1 className="text-[28px] font-semibold leading-tight">管理员入口</h1>
          <p className="mt-2 text-sm leading-6 text-[#333333]">
            登录后可以管理推荐文章、用户与额度、用户反馈，以及站点错误与 Bug。
          </p>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-semibold text-[#333333]">管理员密码</span>
            <ClearableField value={password} onClear={() => setPassword("")} label="清空管理员密码" clearButtonInset="4.4rem" inputPaddingRight="7rem">
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
            </ClearableField>
          </label>
          {loginError && <p className="mt-3 text-sm text-red-600">{loginError}</p>}
          <button className="mt-5 h-11 rounded-full bg-[#0066cc] px-6 text-[17px] text-white" type="submit">
            登录
          </button>
        </form>
      </main>
    );
  }

  if (readerState) {
    const queue = readerState.kind === "candidate" ? candidateArticles : publicArticles;
    const queueIndex = queue.findIndex((item) => item.id === readerState.article.id);
    const drawerSource = editorialDrawer === "candidates" ? candidateArticles : publicArticles;
    const normalizedSearch = editorialSearch.trim().toLocaleLowerCase("zh-CN");
    const drawerItems = drawerSource.filter((article) => {
      const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
      if (editorialDifficulty && recommendation?.difficulty !== editorialDifficulty) return false;
      if (editorialCategory && editorialCategoryForRecommendation(recommendation) !== editorialCategory) return false;
      return !normalizedSearch || `${article.title} ${article.sourceName} ${article.summary}`.toLocaleLowerCase("zh-CN").includes(normalizedSearch);
    });
    return (
      <div className="min-h-screen bg-[#f5f5f7] text-[#17212b]" style={{ colorScheme: "light" }}>
        <AdminArticleMetadataInspector
          key={`${readerState.kind}:${readerState.article.id}`}
          article={readerState.article}
          articleKind={readerState.kind}
          queuePosition={queueIndex >= 0 ? { index: queueIndex, total: queue.length } : undefined}
          onSave={persistReaderMetadata}
          onPrevious={adjacentArticle(-1) ? () => void openAdjacentArticle(-1) : undefined}
          onNext={adjacentArticle(1) ? () => void openAdjacentArticle(1) : undefined}
          onClose={() => setReaderState(null)}
          onSelect={readerState.kind === "candidate" ? selectCurrentCandidate : undefined}
          onReject={readerState.kind === "candidate" ? rejectCurrentCandidate : undefined}
          onDelete={readerState.kind === "published" ? deleteCurrentPublishedArticle : undefined}
        />
        <div className="min-w-0">
          <ReaderView
            key={`${readerState.kind}:${readerState.article.id}`}
            article={readerState.article.body}
            desktopViewportInsetLeft={330}
            editorialWorkbench
            importedArticle={readerState.article.importedArticle ?? null}
            preloadedExplanations={readerState.article.explanations ?? []}
            backLabel="返回后台"
            onBack={() => setReaderState(null)}
            onArticleSaved={() => setArticles(getSavedArticles())}
            onArticleEditCommit={persistReaderArticleEdit}
            onArticleChange={(body, importedArticle) => {
              const savedArticle = pendingSavedReaderArticleRef.current;
              pendingSavedReaderArticleRef.current = null;
              setReaderState((current) => current
                ? {
                    ...current,
                    article: {
                      ...(savedArticle?.id === current.article.id ? savedArticle : current.article),
                      body,
                      ...(importedArticle ? { importedArticle } : { importedArticle: undefined }),
                    },
                  }
                : null);
            }}
          />
        </div>
        <div className="fixed right-3 top-28 z-[55] grid gap-2" aria-label="文章队列">
          <button className="min-h-10 rounded-full border border-[#1769aa] bg-white px-4 text-sm font-semibold text-[#1769aa] shadow-sm" type="button" aria-expanded={editorialDrawer === "candidates"} onClick={() => setEditorialDrawer((current) => current === "candidates" ? null : "candidates")}>候选 {candidateArticles.length}</button>
          <button className="min-h-10 rounded-full border border-[#1769aa] bg-white px-4 text-sm font-semibold text-[#1769aa] shadow-sm" type="button" aria-expanded={editorialDrawer === "published"} onClick={() => setEditorialDrawer((current) => current === "published" ? null : "published")}>精选 {publicArticles.length}</button>
        </div>
        {editorialDrawer && (
          <aside className="fixed inset-y-0 right-0 z-[70] flex w-[min(430px,calc(100vw-24px))] flex-col border-l border-[#d7dde2] bg-white shadow-xl" aria-label={editorialDrawer === "candidates" ? "候选文章列表" : "精选文章列表"}>
            <header className="shrink-0 border-b border-[#d7dde2] px-4 py-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-[#1769aa]">{editorialDrawer === "candidates" ? "待审核队列" : "已精选外刊"}</p><h2 className="mt-1 text-xl font-semibold">{editorialDrawer === "candidates" ? "候选文章" : "精选文章"}</h2></div><button className="h-9 w-9 rounded-full bg-[#f1f4f6] text-xl" type="button" aria-label="关闭文章列表" onClick={() => setEditorialDrawer(null)}>×</button></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <input className="h-10 rounded-lg border border-[#c9ced6] px-3 text-sm" type="search" value={editorialSearch} onChange={(event) => setEditorialSearch(event.target.value)} placeholder="搜索标题或来源" />
                <select className="h-10 rounded-lg border border-[#c9ced6] px-3 text-sm" value={editorialDifficulty} onChange={(event) => setEditorialDifficulty(event.target.value)}><option value="">全部难度</option>{[...new Set(drawerSource.map((item) => item.recommendation?.difficulty).filter(Boolean))].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty}</option>)}</select>
                <select className="h-10 rounded-lg border border-[#c9ced6] px-3 text-sm sm:col-span-2" value={editorialCategory} onChange={(event) => setEditorialCategory(event.target.value)}><option value="">全部栏目</option><option>时事</option><option>科技</option><option>文化</option><option>商业</option></select>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {drawerItems.length ? <ul className="divide-y divide-[#e1e5e9]">{drawerItems.map((article) => {
                const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
                return <li key={article.id}><button className={`w-full px-2 py-4 text-left hover:bg-[#f2f7fa] focus-visible:bg-[#f2f7fa] ${readerState.article.id === article.id ? "bg-[#eaf4fa]" : ""}`} type="button" onClick={() => readerState.kind === "published" && editorialDrawer === "published" ? void openPublishedArticle(article) : editorialDrawer === "candidates" ? openCandidateArticle(article) : void openPublishedArticle(article)}><strong className="block text-sm leading-5">{article.title}</strong><span className="mt-1 block text-xs leading-5 text-[#68737c]">{article.sourceName || "来源待确认"} · {editorialCategoryForRecommendation(recommendation)} · {recommendation?.difficulty || "难度待定"} · {new Date(article.createdAt).toLocaleDateString("zh-CN")}</span></button></li>;
              })}</ul> : <p className="px-3 py-10 text-center text-sm text-[#68737c]">没有符合当前筛选的文章。</p>}
              {editorialDrawer === "candidates" && rejectedArticles.length > 0 && <details className="mt-4 border-t border-[#d7dde2] pt-4"><summary className="cursor-pointer text-sm font-semibold">不精选记录（{rejectedArticles.length}）</summary><ul className="mt-2 divide-y divide-[#e1e5e9]">{rejectedArticles.map((article) => <li key={article.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><strong className="block text-sm leading-5">{article.title}</strong><span className="text-xs text-[#68737c]">{article.sourceName || "来源待确认"}</span></div><button className="shrink-0 rounded-full border border-[#1769aa] px-3 py-1.5 text-xs text-[#1769aa]" type="button" onClick={() => void restoreRejectedArticle(article)}>撤销</button></li>)}</ul></details>}
            </div>
          </aside>
        )}
      </div>
    );
  }

  return (
    <main className="cr-site-background px-4 py-6 text-[#17212b]">
      <SiteBackdrop />
      <section className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[32px] font-semibold leading-tight">Context Reader 管理后台</h1>
            <p className="mt-1 text-sm leading-6 text-[#333333]">
              管理推荐内容、用户额度、反馈处理和站点异常。
            </p>
          </div>
          <button
            className="h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc]"
            type="button"
            onClick={() => void handleLogout()}
          >
            {accessMode === "developer" ? "返回首页" : "退出"}
          </button>
        </header>

        <nav className="mt-5 flex w-full gap-1 rounded-full bg-white p-1 sm:w-fit" aria-label="后台功能">
          <button
            className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
              activeSection === "articles" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "articles" ? "page" : undefined}
            onClick={() => selectSection("articles")}
          >
            推荐文章
          </button>
          <button
            className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
              activeSection === "accounts" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "accounts" ? "page" : undefined}
            onClick={() => selectSection("accounts")}
          >
            用户与额度
          </button>
          <button
            className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
              activeSection === "feedback" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "feedback" ? "page" : undefined}
            onClick={() => selectSection("feedback")}
          >
            用户反馈
          </button>
          <button
            className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
              activeSection === "errors" ? "bg-[#0066cc] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
            }`}
            type="button"
            aria-current={activeSection === "errors" ? "page" : undefined}
            onClick={() => selectSection("errors")}
          >
            错误与 Bug
          </button>
        </nav>

        {activeSection === "errors" ? (
          <div className="mt-6">
            <AdminErrorReportsPanel />
          </div>
        ) : activeSection === "feedback" ? (
          <div className="mt-6">
            <AdminFeedbackPanel />
          </div>
        ) : activeSection === "accounts" ? (
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

        <section className="mt-6 rounded-2xl bg-white p-5 sm:p-6" aria-labelledby="editorial-desk-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#1769aa]">每日内容工作台</p>
              <h2 id="editorial-desk-title" className="mt-1 text-[24px] font-semibold">阅读、判断、继续下一篇</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#4d535a]">候选按最新内容优先排列。左侧修改会自动保存；精选或不精选后自动进入下一篇。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="min-h-11 rounded-full bg-[#1769aa] px-5 text-sm font-semibold text-white disabled:bg-[#aeb8c2]" type="button" disabled={!candidateArticles.length} onClick={() => candidateArticles[0] && openCandidateArticle(candidateArticles[0])}>开始今日精选（{candidateArticles.length}）</button>
              <button className="min-h-11 rounded-full border border-[#1769aa] px-5 text-sm font-semibold text-[#1769aa] disabled:opacity-45" type="button" disabled={!publicArticles.length} onClick={() => publicArticles[0] && void openPublishedArticle(publicArticles[0])}>查看精选列表（{publicArticles.length}）</button>
            </div>
          </div>
          <form className="mt-5 flex flex-col gap-2 border-t border-[#e1e5e9] pt-5 sm:flex-row" onSubmit={handleQuickAddUrl}>
            <label className="min-w-0 flex-1"><span className="sr-only">外刊网址</span><input className="h-11 w-full rounded-lg border border-[#c9ced6] px-4 text-sm outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" type="url" value={quickUrl} onChange={(event) => setQuickUrl(event.target.value)} placeholder="粘贴外刊网址，自动提取、分类并加入候选" required /></label>
            <button className="h-11 rounded-lg bg-[#17212b] px-5 text-sm font-semibold text-white disabled:opacity-45" type="submit" disabled={quickAdding}>{quickAdding ? "正在提取并分类…" : "一键加入候选"}</button>
          </form>
          {rejectedArticles.length > 0 && <p className="mt-3 text-xs text-[#68737c]">另有 {rejectedArticles.length} 篇不精选记录，可在候选工作台右侧列表中撤销。</p>}
        </section>

        <details className="mt-6 rounded-2xl bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">批量导入、封面与自动抓取</summary>
        <div className="mt-5">
          <AdminArticleIntakePanel
            savedArticles={articles}
            publicArticleCount={publicArticles.length}
            onPublished={loadPublicArticles}
            onOpenArticle={openCandidateArticle}
            onShowPublished={() => publicArticlesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        </div>
        </details>

        <details className="mt-6 rounded-2xl bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">栏目主推与顺序微调</summary>
          <AdminHomepageCurationPanel articles={publicArticles} />
        </details>

        <details className="mt-6 rounded-2xl bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">公开文章维护与删除</summary>
        <section ref={publicArticlesRef} className="mt-5 scroll-mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[21px] font-semibold">已公开推荐</h2>
              <p className="mt-1 text-sm leading-6 text-[#333333]">
                这些文章已经进入公开外刊库；是否出现在首页橱窗以及显示顺序，由上方“首页外刊编排”单独控制。
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
            <ul className="mt-4 grid max-h-[min(70vh,760px)] gap-3 overflow-y-auto overscroll-contain border-y border-[#e1e5e9] py-3 pr-2" aria-label="已公开推荐文章列表" tabIndex={0}>
              {publicArticles.map((article) => {
                const localArticle = findMatchingSavedArticle(article);
                const stats = localArticle ? articleStats.get(localArticle.id) : null;
                return (
                <li key={article.id} className="flex flex-col gap-3 rounded-[16px] border border-[#e0e0e0] p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold leading-6">{article.title}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${article.recommendation?.coverImageUrl ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {article.recommendation?.coverImageUrl ? "封面已准备" : "缺少封面"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#333333]">{article.summary || "暂无摘要"}</p>
                    <p className="mt-2 text-xs leading-5 text-[#59636c]">
                      {article.recommendation?.difficulty || "待判断"} · CEFR {article.recommendation?.cefr || "待判断"} · {article.recommendation?.topics.join("、") || "待分类"} · {(article.recommendation?.wordCount ?? countArticleEnglishWords(article.body)).toLocaleString("zh-CN")} 词
                    </p>
                    <p className="text-xs leading-5 text-[#7a7a7a]">
                      适合：{article.recommendation?.audienceStages.join("、") || "待判断"} · {article.recommendation?.timeliness === "time-sensitive" ? "发布前需检查时效" : "长期有效"} · {article.sourceName || "来源待确认"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#7a7a7a]">
                      {localArticle
                        ? `本地对应文章含 ${stats?.explanations ?? 0} 条词义缓存、${stats?.articleTranslations ?? 0} 份全文翻译缓存`
                        : "当前浏览器没有找到对应的本地保存文章"}
                    </p>
                    <p className="mt-1 break-all text-xs leading-5 text-[#7a7a7a]">ID：{article.id}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    <button
                      className="h-9 rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc] disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
                      type="button"
                      disabled={Boolean(openingArticleId)}
                      onClick={() => void openPublishedArticle(article)}
                    >
                      {openingArticleId === article.id ? "正在打开..." : "打开并编辑正文"}
                    </button>
                    <button
                      className="h-9 rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc] disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
                      type="button"
                      disabled={!localArticle || publishingId === localArticle.id}
                      onClick={() => localArticle && handlePublish(localArticle)}
                    >
                      {localArticle && publishingId === localArticle.id ? "更新中..." : localArticle ? "更新预缓存" : "本地无对应文章"}
                    </button>
                    <button
                      className="h-9 rounded-full border border-red-200 px-4 text-sm text-red-600 disabled:text-[#7a7a7a]"
                      type="button"
                      disabled={deletingId === article.id}
                      onClick={() => handleDeletePublicArticle(article)}
                    >
                      {deletingId === article.id ? "删除中..." : "删除公开"}
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </section>
        </details>
          </>
        )}
      </section>
    </main>
  );
}
