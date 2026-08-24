"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ClearableField from "@/components/ClearableField";
import { countArticleEnglishWords } from "@/lib/articleWordCount";
import type { ImportedArticle, SavedArticle } from "@/types/article";
import {
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleAudienceStage,
  type ArticleCefrLevel,
  type ArticleDifficultyEvidence,
  type ArticleDifficulty,
  type ArticleManualField,
  type ArticleRecommendationMetadata,
  type ArticleTimeliness,
  type ArticleTopic,
  type PublicArticle,
  type PublicArticleCandidateInput,
} from "@/types/publicArticle";
import type {
  CrawlerDifficulty,
  RecommendationCrawlerRunResult,
  RecommendationCrawlerStatus,
} from "@/types/recommendationCrawler";

interface ClassificationResponse {
  summary: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  wordCount: number;
  timeliness: ArticleTimeliness;
  reviewNotes: string;
  classificationSource: "model" | "heuristic";
  classifiedAt: string;
  difficultyEvidence: ArticleDifficultyEvidence;
  warning?: string;
}

interface DraftState {
  id: string;
  title: string;
  summary: string;
  body: string;
  sourceUrl: string;
  sourceName: string;
  importedArticle: ImportedArticle | null;
  coverImageUrl: string;
  coverImageAlt: string;
  coverImageSourceUrl: string;
  coverImageCredit: string;
  coverCandidates: string[];
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  wordCount: number;
  timeliness: ArticleTimeliness;
  classificationSource: "model" | "heuristic" | "manual";
  classifiedAt: string;
  reviewNotes: string;
  difficultyEvidence?: ArticleDifficultyEvidence;
  manualFields: ArticleManualField[];
  sourceKind: "manual-paste" | "manual-url" | "local-saved" | "crawler";
}

interface AdminArticleIntakePanelProps {
  onPublished?: () => void | Promise<void>;
  onOpenArticle: (article: PublicArticle) => void;
  onShowPublished?: () => void;
  publicArticleCount?: number;
  savedArticles: SavedArticle[];
}

const EMPTY_DRAFT: DraftState = {
  id: "",
  title: "",
  summary: "",
  body: "",
  sourceUrl: "",
  sourceName: "",
  importedArticle: null,
  coverImageUrl: "",
  coverImageAlt: "",
  coverImageSourceUrl: "",
  coverImageCredit: "",
  coverCandidates: [],
  difficulty: "高中 / CET-4",
  cefr: "B2",
  audienceStages: ["高中", "CET-4"],
  topics: ["社会生活"],
  wordCount: 0,
  timeliness: "evergreen",
  classificationSource: "manual",
  classifiedAt: "",
  reviewNotes: "",
  manualFields: [],
  sourceKind: "manual-paste",
};

const inputClass = "mt-2 w-full rounded-xl border border-[#c9ced6] bg-white px-3.5 py-2.5 text-[15px] text-[#17191c] outline-none transition focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15 disabled:bg-[#f1f3f5]";
const labelClass = "block text-sm font-medium text-[#343a40]";
const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center rounded-full border border-[#b8c7d5] bg-white px-4 text-sm font-medium text-[#175a8d] transition hover:bg-[#edf5fb] focus:outline-none focus:ring-2 focus:ring-[#1769aa]/25 disabled:cursor-not-allowed disabled:opacity-45";
const primaryButtonClass = "inline-flex min-h-10 items-center justify-center rounded-full bg-[#1769aa] px-5 text-sm font-medium text-white transition hover:bg-[#10598f] focus:outline-none focus:ring-2 focus:ring-[#1769aa]/30 disabled:cursor-not-allowed disabled:bg-[#aeb8c2]";

function recommendationFromDraft(draft: DraftState): ArticleRecommendationMetadata {
  return {
    coverImageUrl: draft.coverImageUrl.trim(),
    coverImageAlt: draft.coverImageAlt.trim() || draft.title.trim(),
    coverImageSourceUrl: draft.coverImageSourceUrl.trim(),
    coverImageCredit: draft.coverImageCredit.trim(),
    difficulty: draft.difficulty,
    cefr: draft.cefr,
    audienceStages: draft.audienceStages,
    topics: draft.topics,
    wordCount: countArticleEnglishWords(draft.body),
    timeliness: draft.timeliness,
    sourceKind: draft.sourceKind,
    classificationSource: draft.classificationSource,
    classifiedAt: draft.classifiedAt || new Date().toISOString(),
    reviewNotes: draft.reviewNotes.trim(),
    ...(draft.difficultyEvidence ? { difficultyEvidence: draft.difficultyEvidence } : {}),
    ...(draft.manualFields.length ? { manualFields: draft.manualFields } : {}),
  };
}

function inputFromDraft(draft: DraftState): PublicArticleCandidateInput {
  const recommendation = recommendationFromDraft(draft);
  const importedArticle = draft.importedArticle
    ? { ...draft.importedArticle, title: draft.title.trim(), text: draft.body, recommendation }
    : null;
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    body: draft.body,
    sourceUrl: draft.sourceUrl.trim(),
    sourceName: draft.sourceName.trim(),
    importedArticle,
    recommendation,
  };
}

function draftFromCandidate(article: PublicArticle): DraftState {
  const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
  return {
    ...EMPTY_DRAFT,
    id: article.id,
    title: article.title,
    summary: article.summary,
    body: article.body,
    sourceUrl: article.sourceUrl,
    sourceName: article.sourceName,
    importedArticle: article.importedArticle ?? null,
    coverImageUrl: recommendation?.coverImageUrl ?? "",
    coverImageAlt: recommendation?.coverImageAlt ?? article.title,
    coverImageSourceUrl: recommendation?.coverImageSourceUrl ?? article.sourceUrl,
    coverImageCredit: recommendation?.coverImageCredit ?? "",
    coverCandidates: [
      recommendation?.coverImageUrl ?? "",
      ...(article.importedArticle?.blocks.filter((block) => block.type === "image" && block.src).map((block) => block.src as string) ?? []),
    ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 8),
    difficulty: recommendation?.difficulty ?? EMPTY_DRAFT.difficulty,
    cefr: recommendation?.cefr ?? EMPTY_DRAFT.cefr,
    audienceStages: recommendation?.audienceStages ?? EMPTY_DRAFT.audienceStages,
    topics: recommendation?.topics ?? EMPTY_DRAFT.topics,
    wordCount: recommendation?.wordCount ?? countArticleEnglishWords(article.body),
    timeliness: recommendation?.timeliness ?? "evergreen",
    classificationSource: recommendation?.classificationSource ?? "manual",
    classifiedAt: recommendation?.classifiedAt ?? "",
    reviewNotes: recommendation?.reviewNotes ?? "",
    difficultyEvidence: recommendation?.difficultyEvidence,
    manualFields: recommendation?.manualFields ?? [],
    sourceKind: recommendation?.sourceKind === "crawler"
      ? "crawler"
      : recommendation?.sourceKind === "local-saved"
        ? "local-saved"
        : recommendation?.sourceKind === "manual-url" ? "manual-url" : "manual-paste",
  };
}

function draftFromSavedArticle(article: SavedArticle): DraftState {
  const importedArticle = article.importedArticle ?? null;
  const recommendation = importedArticle?.recommendation;
  const coverCandidates = [
    recommendation?.coverImageUrl ?? "",
    ...(importedArticle?.blocks
      .filter((block) => block.type === "image" && block.src)
      .map((block) => block.src as string) ?? []),
  ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 8);

  return {
    ...EMPTY_DRAFT,
    title: article.title,
    summary: article.summary,
    body: article.body,
    sourceUrl: importedArticle?.url ?? "",
    sourceName: importedArticle?.siteName ?? "",
    importedArticle,
    coverImageUrl: recommendation?.coverImageUrl ?? coverCandidates[0] ?? "",
    coverImageAlt: recommendation?.coverImageAlt ?? article.title,
    coverImageSourceUrl: recommendation?.coverImageSourceUrl ?? importedArticle?.url ?? "",
    coverImageCredit: recommendation?.coverImageCredit ?? "",
    coverCandidates,
    difficulty: recommendation?.difficulty ?? EMPTY_DRAFT.difficulty,
    cefr: recommendation?.cefr ?? EMPTY_DRAFT.cefr,
    audienceStages: recommendation?.audienceStages ?? EMPTY_DRAFT.audienceStages,
    topics: recommendation?.topics ?? EMPTY_DRAFT.topics,
    wordCount: recommendation?.wordCount ?? countArticleEnglishWords(article.body),
    timeliness: recommendation?.timeliness ?? "evergreen",
    classificationSource: recommendation?.classificationSource ?? "manual",
    classifiedAt: recommendation?.classifiedAt ?? "",
    reviewNotes: recommendation?.reviewNotes ?? "",
    difficultyEvidence: recommendation?.difficultyEvidence,
    manualFields: recommendation?.manualFields ?? [],
    sourceKind: "local-saved",
  };
}

export default function AdminArticleIntakePanel({ onPublished, onOpenArticle, onShowPublished, publicArticleCount = 0, savedArticles }: AdminArticleIntakePanelProps) {
  const [mode, setMode] = useState<"local" | "paste" | "url">("local");
  const [url, setUrl] = useState("");
  const [selectedLocalArticleId, setSelectedLocalArticleId] = useState("");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [candidates, setCandidates] = useState<PublicArticle[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [working, setWorking] = useState<"" | "import" | "classify" | "save" | "publish" | "upload" | "crawl" | "daily-fill" | "automation-save" | "automation-run" | "automation-email">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [crawlerTopic, setCrawlerTopic] = useState<ArticleTopic>("科技科学");
  const [crawlerDifficulty, setCrawlerDifficulty] = useState<CrawlerDifficulty>("any");
  const [crawlerMaxArticles, setCrawlerMaxArticles] = useState(2);
  const [crawlerStatus, setCrawlerStatus] = useState<RecommendationCrawlerStatus | null>(null);
  const [crawlerResult, setCrawlerResult] = useState<RecommendationCrawlerRunResult | null>(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [automationRunTime, setAutomationRunTime] = useState("03:00");
  const [automationMaxArticles, setAutomationMaxArticles] = useState(2);
  const [dailyFillProgress, setDailyFillProgress] = useState({ completed: 0, created: 0, total: ARTICLE_TOPICS.length });
  const [recentCandidateIds, setRecentCandidateIds] = useState<string[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);
  const candidateSectionRef = useRef<HTMLElement>(null);
  const candidateListRef = useRef<HTMLUListElement>(null);

  const missingCoverCount = useMemo(
    () => candidates.filter((article) => !article.recommendation?.coverImageUrl?.trim()).length,
    [candidates],
  );

  async function loadCandidates() {
    setLoadingCandidates(true);
    const response = await fetch("/api/admin/article-candidates", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { articles?: PublicArticle[]; error?: string } | null;
    if (!response.ok) {
      setError(data?.error || "候选文章读取失败。");
      setLoadingCandidates(false);
      return;
    }
    const next = data?.articles ?? [];
    setCandidates(next);
    setSelectedIds((ids) => ids.filter((id) => next.some((article) => article.id === id)));
    setLoadingCandidates(false);
  }

  async function loadCrawlerStatus() {
    const response = await fetch("/api/admin/article-crawler", { cache: "no-store" });
    const data = await response.json().catch(() => null) as (RecommendationCrawlerStatus & { error?: string }) | null;
    if (response.ok && data) {
      setCrawlerStatus(data);
      setAutomationEnabled(data.automation.config.enabled);
      setAutomationRunTime(data.automation.config.runTime);
      setAutomationMaxArticles(data.automation.config.maxNewArticles);
    }
  }

  async function handleSaveAutomation() {
    setWorking("automation-save");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/article-crawler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: automationEnabled,
          runTime: automationRunTime,
          maxNewArticles: automationMaxArticles,
        }),
      });
      const data = await response.json().catch(() => null) as { automation?: RecommendationCrawlerStatus["automation"]; error?: string } | null;
      if (!response.ok || !data?.automation) {
        throw new Error(data?.error || "定时设置保存失败。");
      }
      await loadCrawlerStatus();
      setMessage(automationEnabled
        ? `已保存：每天约 ${automationRunTime} 自动补充，单次最多加入 ${automationMaxArticles} 篇候选。`
        : "已关闭定时自动补充，网站和手动扫描不受影响。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "定时设置保存失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleRunAutomationNow() {
    setWorking("automation-run");
    setError("");
    setMessage("");
    setCrawlerResult(null);
    try {
      const saveResponse = await fetch("/api/admin/article-crawler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: automationEnabled,
          runTime: automationRunTime,
          maxNewArticles: automationMaxArticles,
        }),
      });
      const saveData = await saveResponse.json().catch(() => null) as { error?: string } | null;
      if (!saveResponse.ok) {
        throw new Error(saveData?.error || "当前设置保存失败，尚未执行抓取。");
      }
      const response = await fetch("/api/admin/article-crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" }),
      });
      const data = await response.json().catch(() => null) as { result?: RecommendationCrawlerRunResult; error?: string } | null;
      if (!response.ok || !data?.result) {
        throw new Error(data?.error || "立即执行失败。");
      }
      setCrawlerResult(data.result);
      setRecentCandidateIds(data.result.created.map((article) => article.id));
      await Promise.all([loadCandidates(), loadCrawlerStatus()]);
      setMessage(data.result.created.length
        ? `手动执行完成，已加入 ${data.result.created.length} 篇候选。手动执行不会发送定时完成邮件。`
        : "手动执行完成，本次没有新增候选。可能是链接已经入库，或没有文章通过读取与质量检查。");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "立即执行失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleTestAutomationEmail() {
    setWorking("automation-email");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/article-crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_email" }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || "测试邮件发送失败。");
      }
      setMessage(`测试邮件已发送到 ${automation?.notificationEmail || "通知邮箱"}，请留意收件箱和垃圾邮件。`);
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "测试邮件发送失败。");
    } finally {
      setWorking("");
    }
  }

  useEffect(() => {
    void loadCandidates();
    void loadCrawlerStatus();
  }, []);

  async function handleRunCrawler() {
    setWorking("crawl");
    setError("");
    setMessage("");
    setCrawlerResult(null);
    try {
      const response = await fetch("/api/admin/article-crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: crawlerTopic,
          difficulty: crawlerDifficulty,
          maxNewArticles: crawlerMaxArticles,
          inventoryScope: "candidates",
        }),
      });
      const data = await response.json().catch(() => null) as { result?: RecommendationCrawlerRunResult; error?: string } | null;
      if (!response.ok || !data?.result) {
        throw new Error(data?.error || "自动抓取任务失败。");
      }
      setCrawlerResult(data.result);
      setRecentCandidateIds(data.result.created.map((article) => article.id));
      await loadCandidates();
      const createdCount = data.result.created.length;
      setMessage(createdCount
        ? `扫描完成，已新增 ${createdCount} 篇${crawlerTopic}候选文章。它们已标记为“本次新增”。`
        : `扫描完成，本次没有找到可加入的文章。可能是链接已经入库，或新内容没有通过读取、难度与质量检查。`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "自动抓取任务失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleDailyFill() {
    setWorking("daily-fill");
    setError("");
    setMessage("");
    setCrawlerResult(null);
    setDailyFillProgress({ completed: 0, created: 0, total: ARTICLE_TOPICS.length });
    let created = 0;
    const createdIds: string[] = [];
    const failures: string[] = [];

    for (let index = 0; index < ARTICLE_TOPICS.length; index += 1) {
      const topic = ARTICLE_TOPICS[index];
      try {
        const response = await fetch("/api/admin/article-crawler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            difficulty: "any",
            maxNewArticles: 2,
            inventoryScope: "candidates",
          }),
        });
        const data = await response.json().catch(() => null) as { result?: RecommendationCrawlerRunResult; error?: string } | null;
        if (!response.ok || !data?.result) {
          failures.push(`${topic}：${data?.error || "补充失败"}`);
        } else {
          created += data.result.created.length;
          createdIds.push(...data.result.created.map((article) => article.id));
          setCrawlerResult(data.result);
        }
      } catch {
        failures.push(`${topic}：网络暂时不可用`);
      }
      setDailyFillProgress({ completed: index + 1, created, total: ARTICLE_TOPICS.length });
    }

    await loadCandidates();
    setRecentCandidateIds(createdIds);
    if (failures.length) {
      setError(`已完成其余主题，但 ${failures.join("；")}`);
    }
    setMessage(created
      ? `今日补充完成，共加入 ${created} 篇候选。系统已按六类主题轮流取材，请从候选区继续筛查。`
      : "六个主题扫描完成，没有新增文章。链接可能已经入库，或本轮文章没有通过读取与质量检查。");
    setWorking("");
  }

  function resetDraft(nextMode: "local" | "paste" | "url" = mode) {
    setDraft({
      ...EMPTY_DRAFT,
      sourceKind: nextMode === "local" ? "local-saved" : nextMode === "url" ? "manual-url" : "manual-paste",
    });
    setMode(nextMode);
    setUrl("");
    setSelectedLocalArticleId("");
    setMessage("");
    setError("");
  }

  function applyClassification(base: DraftState, classification: ClassificationResponse): DraftState {
    const locked = new Set(base.manualFields);
    return {
      ...base,
      summary: locked.has("summary") ? base.summary : classification.summary,
      difficulty: locked.has("difficulty") ? base.difficulty : classification.difficulty,
      cefr: locked.has("cefr") ? base.cefr : classification.cefr,
      audienceStages: locked.has("audienceStages") ? base.audienceStages : classification.audienceStages,
      topics: locked.has("topics") ? base.topics : classification.topics,
      wordCount: classification.wordCount,
      timeliness: locked.has("timeliness") ? base.timeliness : classification.timeliness,
      classificationSource: base.manualFields.length ? "manual" : classification.classificationSource,
      classifiedAt: classification.classifiedAt,
      reviewNotes: locked.has("reviewNotes") ? base.reviewNotes : classification.reviewNotes,
      difficultyEvidence: classification.difficultyEvidence,
    };
  }

  async function classifyDraft(base: DraftState): Promise<DraftState> {
    setWorking("classify");
    const response = await fetch("/api/admin/article-classification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: base.title,
        text: base.body,
        sourceUrl: base.sourceUrl,
        sourceName: base.sourceName,
      }),
    });
    const data = await response.json().catch(() => null) as { classification?: ClassificationResponse; error?: string } | null;
    if (!response.ok || !data?.classification) {
      throw new Error(data?.error || "文章判断失败。");
    }
    const next = applyClassification(base, data.classification);
    setDraft(next);
    setMessage(data.classification.warning || "已完成难度、适合人群和兴趣类型判断。");
    return next;
  }

  async function handleSelectLocalArticle(articleId: string) {
    setSelectedLocalArticleId(articleId);
    setError("");
    setMessage("");
    if (!articleId) {
      resetDraft("local");
      return;
    }
    const article = savedArticles.find((item) => item.id === articleId);
    if (!article) {
      setError("没有找到这篇本地保存文章，请刷新后台后重试。");
      return;
    }
    if (article.body.trim().length < 80) {
      setError("这篇本地文章正文不足 80 个字符，暂时不能加入候选。");
      return;
    }

    const localDraft = draftFromSavedArticle(article);
    setDraft(localDraft);
    setUrl(localDraft.sourceUrl);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await classifyDraft(localDraft);
      setMessage(localDraft.coverImageUrl
        ? "已载入本地文章并完成自动分类，请检查封面与摘要后保存到候选库。"
        : "已载入本地文章并完成自动分类，请补充推荐封面后保存到候选库。"
      );
    } catch (classificationError) {
      setError(`本地文章已载入，但自动分类失败：${classificationError instanceof Error ? classificationError.message : "请稍后重试"}`);
    } finally {
      setWorking("");
    }
  }

  async function handleImportUrl() {
    if (!url.trim()) {
      setError("请先输入文章 URL。");
      return;
    }
    setWorking("import");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await response.json().catch(() => null) as {
        article?: ImportedArticle;
        metadata?: { description?: string; coverCandidates?: string[] };
        error?: string;
      } | null;
      if (!response.ok || !data?.article?.text?.trim()) {
        throw new Error(data?.error || "网址导入失败。");
      }
      const coverImageUrl = data.metadata?.coverCandidates?.[0] ?? "";
      const importedDraft: DraftState = {
        ...EMPTY_DRAFT,
        title: data.article.title,
        summary: data.metadata?.description?.trim() ?? "",
        body: data.article.text,
        sourceUrl: data.article.url,
        sourceName: data.article.siteName,
        importedArticle: data.article,
        coverImageUrl,
        coverImageAlt: data.article.title,
        coverImageSourceUrl: data.article.url,
        coverCandidates: data.metadata?.coverCandidates ?? [],
        wordCount: countArticleEnglishWords(data.article.text),
        sourceKind: "manual-url",
      };
      setDraft(importedDraft);
      setWorking("");
      await classifyDraft(importedDraft);
      setMessage(coverImageUrl
        ? "正文、图片和文章类型已整理，请检查封面与摘要后保存。"
        : "正文和文章类型已整理，但没有找到合适封面，请补充后再发布。"
      );
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "网址导入失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleClassify() {
    setError("");
    setMessage("");
    if (!draft.title.trim() || draft.body.trim().length < 80) {
      setError("请先填写标题和至少 80 个字符的英文正文。");
      return;
    }
    try {
      await classifyDraft(draft);
    } catch (classificationError) {
      setError(classificationError instanceof Error ? classificationError.message : "文章判断失败。");
    } finally {
      setWorking("");
    }
  }

  async function saveCandidate(base = draft): Promise<PublicArticle> {
    let readyDraft = base;
    if (!readyDraft.classifiedAt) {
      readyDraft = await classifyDraft(readyDraft);
    }
    setWorking("save");
    const response = await fetch("/api/admin/article-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputFromDraft(readyDraft)),
    });
    const data = await response.json().catch(() => null) as { article?: PublicArticle; error?: string } | null;
    if (!response.ok || !data?.article) {
      throw new Error(data?.error || "候选文章保存失败。");
    }
    setDraft(draftFromCandidate(data.article));
    await loadCandidates();
    return data.article;
  }

  async function handleSave() {
    setError("");
    setMessage("");
    if (!draft.title.trim() || draft.body.trim().length < 80) {
      setError("请先填写标题和至少 80 个字符的正文。");
      return;
    }
    try {
      const article = await saveCandidate();
      setMessage(article.recommendation?.coverImageUrl
        ? "候选文章已保存，可以继续审核或发布。"
        : "候选文章已保存，并已加入“缺少封面”提醒。"
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "候选文章保存失败。");
    } finally {
      setWorking("");
    }
  }

  async function publishIds(ids: string[]) {
    setWorking("publish");
    const response = await fetch("/api/admin/article-candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", ids }),
    });
    const data = await response.json().catch(() => null) as { articles?: PublicArticle[]; error?: string } | null;
    if (!response.ok) {
      throw new Error(data?.error || "候选文章发布失败。");
    }
    await loadCandidates();
    await onPublished?.();
    return data?.articles ?? [];
  }

  async function handleBatchPublish() {
    setError("");
    setMessage("");
    const selected = candidates.filter((article) => selectedIds.includes(article.id));
    const missing = selected.filter((article) => !article.recommendation?.coverImageUrl?.trim());
    if (selected.length === 0) {
      setError("请先选择要发布的候选文章。");
      return;
    }
    if (missing.length > 0) {
      setError(`有 ${missing.length} 篇缺少推荐封面，请逐篇补充后再批量发布。`);
      return;
    }
    try {
      const published = await publishIds(selected.map((article) => article.id));
      setSelectedIds([]);
      setMessage(`已发布 ${published.length} 篇推荐文章。`);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "批量发布失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleDeleteCandidate(article: PublicArticle) {
    if (!window.confirm(`删除候选《${article.title}》吗？`)) {
      return;
    }
    setError("");
    const response = await fetch(`/api/admin/article-candidates?id=${encodeURIComponent(article.id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(data?.error || "候选文章删除失败。");
      return;
    }
    if (draft.id === article.id) {
      resetDraft(mode);
    }
    await loadCandidates();
    setMessage(`已删除候选《${article.title}》。`);
  }

  async function handleCoverUpload(file: File | null) {
    if (!file) return;
    setWorking("upload");
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/admin/article-covers", { method: "POST", body: formData });
      const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || "封面上传失败。");
      }
      setDraft((current) => ({
        ...current,
        coverImageUrl: data.url || "",
        coverImageSourceUrl: "",
        coverImageAlt: current.coverImageAlt || current.title,
      }));
      setMessage("封面已上传，请检查裁切预览。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "封面上传失败。");
    } finally {
      setWorking("");
    }
  }

  const busy = Boolean(working);
  const activeCrawlerSources = crawlerStatus?.sources.filter((source) => source.topics.includes(crawlerTopic)) ?? [];
  const automation = crawlerStatus?.automation;
  const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const nextRunLabel = automation?.nextRunAt ? dateTimeFormatter.format(new Date(automation.nextRunAt)) : "已关闭";
  const lastRunLabel = automation?.state.lastFinishedAt
    ? `${dateTimeFormatter.format(new Date(automation.state.lastFinishedAt))} · ${automation.state.status === "succeeded" ? "成功" : automation.state.status === "failed" ? "失败" : "执行中"} · 新增 ${automation.state.lastCreatedCount} 篇`
    : "尚未执行";
  const emailStatusLabel = automation?.state.lastEmailStatus === "sent"
    ? "上次定时邮件已发送"
    : automation?.state.lastEmailStatus === "failed"
      ? "上次任务成功，但邮件发送失败"
      : automation?.state.lastEmailStatus === "not_configured"
        ? "站点通知邮箱尚未配置"
        : "定时任务成功后发送邮件";

  function showCandidates(ids: string[] = []) {
    candidateSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!ids.length) return;
    window.setTimeout(() => {
      const target = candidateListRef.current?.querySelector<HTMLElement>(`[data-candidate-id="${CSS.escape(ids[0])}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target?.focus({ preventScroll: true });
    }, 260);
  }

  return (
    <>
      <div className="grid gap-5">
        {(message || error) && (
          <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${error ? "border-red-200 bg-red-50 text-red-800" : "border-[#bfd4e5] bg-[#edf5fb] text-[#174d73]"}`} role={error ? "alert" : "status"}>
            {error || message}
          </div>
        )}

        <section className="overflow-hidden rounded-2xl bg-white" aria-labelledby="recommendation-discovery-title">
          <div className="flex flex-col gap-4 border-b border-[#e1e5e9] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div>
              <h2 id="recommendation-discovery-title" className="text-xl font-semibold text-[#17191c]">补充候选文章</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#4d535a]">手动扫描会立刻运行，定时补充由服务器按北京时间执行。两种方式都只加入候选，不会自动发布。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={secondaryButtonClass} type="button" onClick={() => showCandidates()}>查看候选（{candidates.length}）</button>
              <button className={secondaryButtonClass} type="button" onClick={onShowPublished}>查看已公开（{publicArticleCount}）</button>
            </div>
          </div>

          <div className="grid xl:grid-cols-2 xl:divide-x xl:divide-[#e1e5e9]">
            <section className="px-5 py-5 sm:px-6" aria-labelledby="manual-discovery-title">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 id="manual-discovery-title" className="text-base font-semibold text-[#17191c]">现在手动扫描</h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-[#4d5963]">点击后读取所选主题的可信来源，排除已入库链接，再导入和判断文章。完成后会自动刷新候选列表。</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#edf5fb] px-3 py-1 text-xs font-medium text-[#174d73]">不会自动发布</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>文章主题<select className={inputClass} value={crawlerTopic} onChange={(event) => setCrawlerTopic(event.target.value as ArticleTopic)} disabled={busy}>{ARTICLE_TOPICS.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
                <label className={labelClass}>文章难度<select className={inputClass} value={crawlerDifficulty} onChange={(event) => setCrawlerDifficulty(event.target.value as CrawlerDifficulty)} disabled={busy}><option value="any">自动判断，不限难度</option>{ARTICLE_DIFFICULTIES.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}</select></label>
                <label className={labelClass}>本次最多新增<input className={inputClass} type="number" min={1} max={6} value={crawlerMaxArticles} onChange={(event) => setCrawlerMaxArticles(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} disabled={busy} /></label>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#5c6872]">这是本次新增上限，不是库存上限。即使已有很多候选，系统也会继续寻找；重复或不合格文章不会为了凑数而加入。</p>
              <details className="mt-3 text-xs text-[#59636c]"><summary className="cursor-pointer font-medium text-[#4d5963]">查看本主题来源</summary><div className="mt-2 flex flex-wrap gap-2">{activeCrawlerSources.map((source) => <span key={source.id} className="rounded-full bg-[#eef1f4] px-2.5 py-1 text-[#3f4850]">{source.name}</span>)}</div></details>
              <button className={`${primaryButtonClass} mt-4`} type="button" onClick={() => void handleRunCrawler()} disabled={busy}>{working === "crawl" ? "正在扫描，请稍候..." : `开始扫描，最多新增 ${crawlerMaxArticles} 篇`}</button>
            </section>

            <section className="border-t border-[#e1e5e9] px-5 py-5 sm:px-6 xl:border-t-0" aria-labelledby="recommendation-automation-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="recommendation-automation-title" className="text-base font-semibold text-[#17191c]">每天自动补充</h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-[#4d5963]">服务器每 5 分钟检查一次是否到点，电脑关机也会运行，同一天只自动执行一次。</p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-[#5c6872]">为避免候选无限堆积，自动任务只补充候选少于 30 篇的当天主题。这是自动维护目标，不是网站容量上限；手动扫描不受影响。</p>
                </div>
                <label className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 self-start whitespace-nowrap rounded-full bg-[#f2f5f7] px-3.5 text-sm font-medium text-[#343a40]">
                  <input className="h-5 w-5 accent-[#1769aa]" type="checkbox" checked={automationEnabled} onChange={(event) => setAutomationEnabled(event.target.checked)} disabled={busy} />
                  {automationEnabled ? "已开启" : "已关闭"}
                </label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>每天执行时间（北京时间）<input className={inputClass} type="time" step={300} value={automationRunTime} onChange={(event) => setAutomationRunTime(event.target.value)} disabled={busy || !automationEnabled} /></label>
                <label className={labelClass}>每次最多新增<input className={inputClass} type="number" min={1} max={6} value={automationMaxArticles} onChange={(event) => setAutomationMaxArticles(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} disabled={busy || !automationEnabled} /></label>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm text-[#46515a] sm:grid-cols-2">
                <div><dt className="text-xs text-[#6b747c]">下次执行</dt><dd className="mt-0.5 font-medium text-[#29323a]">{nextRunLabel}</dd></div>
                <div><dt className="text-xs text-[#6b747c]">上次执行</dt><dd className="mt-0.5 font-medium text-[#29323a]">{lastRunLabel}</dd></div>
                <div><dt className="text-xs text-[#6b747c]">成功通知邮箱</dt><dd className="mt-0.5 break-all font-medium text-[#29323a]">{automation?.notificationEmail || "尚未配置"}</dd></div>
                <div><dt className="text-xs text-[#6b747c]">邮件状态</dt><dd className={`mt-0.5 font-medium ${automation?.state.lastEmailStatus === "failed" || automation?.state.lastEmailStatus === "not_configured" ? "text-[#9b3524]" : "text-[#29323a]"}`}>{emailStatusLabel}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={primaryButtonClass} type="button" onClick={() => void handleSaveAutomation()} disabled={busy}>{working === "automation-save" ? "正在保存..." : "保存自动设置"}</button>
                <button className={secondaryButtonClass} type="button" onClick={() => void handleRunAutomationNow()} disabled={busy}>{working === "automation-run" ? "正在扫描，请稍候..." : "立即按自动规则运行"}</button>
                <button className={secondaryButtonClass} type="button" onClick={() => void handleTestAutomationEmail()} disabled={busy || !automation?.emailConfigured}>{working === "automation-email" ? "正在发送..." : "发送测试邮件"}</button>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#5c6872]">立即运行会使用右侧的篇数设置，但不会改变下一次定时时间，也不会发送完成邮件。</p>
              {automation?.state.lastError && <p className="mt-3 rounded-lg bg-[#fff0ed] px-3 py-2 text-xs leading-5 text-[#8d3224]">{automation.state.lastError}</p>}
            </section>
          </div>

          {(working === "crawl" || working === "automation-run" || working === "daily-fill") && (
            <div className="border-t border-[#c9ddeb] bg-[#edf5fb] px-5 py-4 text-sm leading-6 text-[#174d73] sm:px-6" role="status" aria-live="polite">
              <strong>{working === "daily-fill" ? `正在扫描六个主题（${dailyFillProgress.completed}/${dailyFillProgress.total}）` : "正在读取来源、去重并分析文章"}</strong>
              <span className="ml-2">这个过程通常需要几十秒到几分钟，完成后这里会显示结果并刷新候选列表，请不要重复点击。</span>
            </div>
          )}

          {crawlerResult && !["crawl", "automation-run", "daily-fill"].includes(working) && (
            <div className="border-t border-[#c9ddeb] bg-[#f5f9fc] px-5 py-4 sm:px-6" role="status" aria-live="polite">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="text-sm leading-6 text-[#3f4850]">
                  <strong className="text-[#173f5f]">扫描完成</strong>
                  <span className="ml-2">发现 {crawlerResult.discovered} 个未入库链接，尝试分析 {crawlerResult.attempted} 篇，新增 {crawlerResult.created.length} 篇。</span>
                  {crawlerResult.created.length === 0 && <p className="mt-1 text-[#59636c]">没有达到新增条件：链接可能已经入库，或文章没有通过读取、难度与质量检查。这不是容量上限。</p>}
                </div>
                {crawlerResult.created.length > 0 && <button className={primaryButtonClass} type="button" onClick={() => showCandidates(recentCandidateIds)}>查看本次新增（{crawlerResult.created.length}）</button>}
              </div>
              {crawlerResult.created.length > 0 && <ul className="mt-3 grid gap-1 text-sm text-[#174d73]">{crawlerResult.created.map((article) => <li key={article.id}>《{article.title}》</li>)}</ul>}
              {(crawlerResult.skipped.length > 0 || crawlerResult.sourceErrors.length > 0) && <details className="mt-3 text-xs text-[#59636c]"><summary className="cursor-pointer font-medium">查看跳过与读取失败详情</summary><div className="mt-2"><p>跳过 {crawlerResult.skipped.length} 篇，来源读取失败 {crawlerResult.sourceErrors.length} 个。</p>{crawlerResult.skipped.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{crawlerResult.skipped.map((item) => <li key={`${item.url}-${item.reason}`}>{item.title}：{item.reason}</li>)}</ul>}</div></details>}
            </div>
          )}

          <details className="border-t border-[#e1e5e9] px-5 py-4 sm:px-6">
            <summary className="cursor-pointer text-sm font-medium text-[#175a8d]">高级操作：一次扫描六个主题</summary>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-xs leading-5 text-[#4d6577]">依次扫描六类主题，每类最多新增 2 篇，一次最多新增 12 篇。适合临时集中备稿。</p><button className={secondaryButtonClass} type="button" onClick={() => void handleDailyFill()} disabled={busy}>{working === "daily-fill" ? `扫描中 ${dailyFillProgress.completed}/${dailyFillProgress.total}` : "扫描六个主题"}</button></div>
          </details>
        </section>

        <section className="rounded-2xl bg-white px-5 py-5 sm:px-6">
          <h2 className="text-xl font-semibold text-[#17191c]">推荐文章工作流</h2>
          <ol className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              ["1", "选择来源", "本地文章、粘贴正文或 URL"],
              ["2", "整理候选", "系统判断类型，你只检查摘要和封面"],
              ["3", "候选审核", "预览用户最终看到的文章视图"],
              ["4", "选择发布", "只从候选列表发布到首页"],
            ].map(([number, title, detail]) => <li key={number} className="flex gap-3 rounded-xl bg-[#f1f4f6] px-4 py-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1769aa] text-sm font-semibold text-white">{number}</span><span><strong className="block text-sm text-[#17191c]">{title}</strong><span className="mt-0.5 block text-xs leading-5 text-[#59636c]">{detail}</span></span></li>)}
          </ol>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white">
        <div className="border-b border-[#e1e5e9] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#17191c]">建立候选</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#4d535a]">三种来源进入同一个编辑器。系统负责分类，你只需要确认文章、摘要和推荐封面。</p>
            </div>
            <button className={secondaryButtonClass} type="button" onClick={() => resetDraft(mode)} disabled={busy}>清空当前内容</button>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-[#eef1f4] p-1" aria-label="候选文章来源">
            <button className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${mode === "local" ? "bg-white text-[#17191c]" : "text-[#4d535a] hover:text-[#17191c]"}`} type="button" aria-pressed={mode === "local"} onClick={() => resetDraft("local")}>本地文章</button>
            <button className={`min-h-10 rounded-lg px-4 text-sm font-medium transition ${mode === "paste" ? "bg-white text-[#17191c]" : "text-[#4d535a] hover:text-[#17191c]"}`} type="button" aria-pressed={mode === "paste"} onClick={() => resetDraft("paste")}>粘贴文章</button>
            <button className={`min-h-10 rounded-lg px-4 text-sm font-medium transition ${mode === "url" ? "bg-white text-[#17191c]" : "text-[#4d535a] hover:text-[#17191c]"}`} type="button" aria-pressed={mode === "url"} onClick={() => resetDraft("url")}>输入 URL</button>
          </div>
        </div>

        <div ref={editorRef} className="grid gap-6 px-5 py-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:px-6">
          <div className="min-w-0">
            {mode === "local" ? (
              <div>
                <label className={labelClass} htmlFor="admin-local-article">选择本地已保存文章</label>
                <select id="admin-local-article" className={inputClass} value={selectedLocalArticleId} onChange={(event) => void handleSelectLocalArticle(event.target.value)} disabled={busy || savedArticles.length === 0}>
                  <option value="">{savedArticles.length ? `从 ${savedArticles.length} 篇文章中选择` : "还没有本地保存文章"}</option>
                  {savedArticles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
                </select>
                {!savedArticles.length && <p className="mt-3 rounded-xl bg-[#f1f4f6] px-4 py-3 text-sm leading-6 text-[#59636c]">先在首页或阅读器保存文章，刷新后台后即可在这里选择。</p>}
              </div>
            ) : mode === "url" ? (
              <div>
                <label className={labelClass} htmlFor="admin-article-url">文章 URL</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <ClearableField className="min-w-0 flex-1" value={url} onClear={() => setUrl("")} label="清空文章网址" disabled={busy}>
                    <input id="admin-article-url" className="min-h-11 w-full rounded-xl border border-[#c9ced6] bg-white px-3.5 text-[15px] outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" disabled={busy} />
                  </ClearableField>
                  <button className={primaryButtonClass} type="button" onClick={handleImportUrl} disabled={busy}>{working === "import" || working === "classify" ? "读取并判断中..." : "读取并判断文章"}</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <label className={labelClass}>文章标题<ClearableField value={draft.title} onClear={() => setDraft((current) => ({ ...current, title: "" }))} label="清空文章标题" disabled={busy}><input className={inputClass} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, coverImageAlt: current.coverImageAlt || event.target.value }))} maxLength={200} placeholder="输入英文文章标题" disabled={busy} /></ClearableField></label>
                <label className={labelClass}>英文正文<ClearableField value={draft.body} onClear={() => setDraft((current) => ({ ...current, body: "", importedArticle: null, classifiedAt: "" }))} label="清空英文正文" disabled={busy} multiline><textarea className={`${inputClass} min-h-72 resize-y leading-7`} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value, importedArticle: null, classifiedAt: "" }))} placeholder="粘贴完整英文文章" disabled={busy} /></ClearableField></label>
              </div>
            )}

            {mode !== "paste" && draft.body && (
              <div className="mt-5 rounded-xl bg-[#f3f5f7] p-4">
                <p className="font-medium text-[#17191c]">{draft.title}</p>
                <p className="mt-1 text-sm text-[#4d535a]">{draft.sourceName || "本地保存"}，正文 {draft.body.length.toLocaleString("zh-CN")} 字符，保留 {draft.importedArticle?.blocks.filter((block) => block.type === "image").length ?? 0} 张正文配图</p>
              </div>
            )}

            <div className="mt-6 grid gap-4">
              <label className={labelClass}>推荐摘要<ClearableField value={draft.summary} onClear={() => setDraft((current) => ({ ...current, summary: "", manualFields: current.manualFields.includes("summary") ? current.manualFields : [...current.manualFields, "summary"], classificationSource: "manual" }))} label="清空推荐摘要" disabled={busy} multiline><textarea className={`${inputClass} min-h-24 resize-y leading-6`} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value, manualFields: current.manualFields.includes("summary") ? current.manualFields : [...current.manualFields, "summary"], classificationSource: "manual" }))} maxLength={1000} placeholder="用于封面旁边的文章摘要" disabled={busy} /></ClearableField></label>
              <details className="rounded-xl bg-[#f3f5f7] px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-[#4d535a]">检查来源信息</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className={labelClass}>来源名称<ClearableField value={draft.sourceName} onClear={() => setDraft((current) => ({ ...current, sourceName: "" }))} label="清空来源名称" disabled={busy}><input className={inputClass} value={draft.sourceName} onChange={(event) => setDraft((current) => ({ ...current, sourceName: event.target.value }))} maxLength={200} disabled={busy} /></ClearableField></label><label className={labelClass}>来源 URL<ClearableField value={draft.sourceUrl} onClear={() => setDraft((current) => ({ ...current, sourceUrl: "" }))} label="清空来源网址" disabled={busy}><input className={inputClass} value={draft.sourceUrl} onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))} maxLength={2048} disabled={busy} /></ClearableField></label></div></details>
            </div>
          </div>

          <div className="min-w-0 border-t border-[#e1e5e9] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-[#17191c]">封面与推荐信息</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${draft.coverImageUrl ? "bg-[#e9f5ee] text-[#17613b]" : "bg-[#fff0ed] text-[#9b3524]"}`}>{draft.coverImageUrl ? "封面已准备" : "缺少封面"}</span>
            </div>

            <div className="mt-4 aspect-[16/9] overflow-hidden rounded-xl bg-[#e8edf1]">
              {draft.coverImageUrl ? <img className="h-full w-full object-cover" src={draft.coverImageUrl} alt={draft.coverImageAlt || draft.title || "推荐封面预览"} /> : <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-6 text-[#59636c]">没有抓到合适封面时，可以上传你准备的图片。缺封面的文章只能保存为候选。</div>}
            </div>
            {draft.coverCandidates.length > 1 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-[#343a40]">从原文图片中选择封面</p>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {draft.coverCandidates.map((candidate) => (
                    <button
                      key={candidate}
                      className={`aspect-[4/3] overflow-hidden rounded-lg border-2 transition focus:outline-none focus:ring-2 focus:ring-[#1769aa]/30 ${draft.coverImageUrl === candidate ? "border-[#1769aa]" : "border-transparent hover:border-[#b8c7d5]"}`}
                      type="button"
                      aria-label="选择这张原文图片作为封面"
                      aria-pressed={draft.coverImageUrl === candidate}
                      onClick={() => setDraft((current) => ({ ...current, coverImageUrl: candidate, coverImageSourceUrl: current.sourceUrl }))}
                    >
                      <img className="h-full w-full object-cover" src={candidate} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 grid gap-4">
              <label className={labelClass}>封面图片 URL<ClearableField value={draft.coverImageUrl} onClear={() => setDraft((current) => ({ ...current, coverImageUrl: "" }))} label="清空封面图片网址" disabled={busy}><input className={inputClass} type="url" value={draft.coverImageUrl} onChange={(event) => setDraft((current) => ({ ...current, coverImageUrl: event.target.value }))} placeholder="抓取结果或公开图片地址" disabled={busy} /></ClearableField></label>
              <label className={labelClass}>上传封面图片<input className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[#edf5fb] file:px-3 file:py-1.5 file:text-sm file:text-[#175a8d]`} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)} disabled={busy} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>图片说明<ClearableField value={draft.coverImageAlt} onClear={() => setDraft((current) => ({ ...current, coverImageAlt: "" }))} label="清空图片说明" disabled={busy}><input className={inputClass} value={draft.coverImageAlt} onChange={(event) => setDraft((current) => ({ ...current, coverImageAlt: event.target.value }))} maxLength={300} disabled={busy} /></ClearableField></label>
                <label className={labelClass}>图片署名<ClearableField value={draft.coverImageCredit} onClear={() => setDraft((current) => ({ ...current, coverImageCredit: "" }))} label="清空图片署名" disabled={busy}><input className={inputClass} value={draft.coverImageCredit} onChange={(event) => setDraft((current) => ({ ...current, coverImageCredit: event.target.value }))} maxLength={300} placeholder="作者或来源" disabled={busy} /></ClearableField></label>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-[#edf5fb] px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><h4 className="text-sm font-semibold text-[#174d73]">系统自动判断</h4><p className="mt-1 text-xs leading-5 text-[#4d6577]">无需手动选择类型。保存前系统会根据完整正文判断并写入候选。</p></div>
                <button className={secondaryButtonClass} type="button" onClick={handleClassify} disabled={busy || !draft.title.trim() || draft.body.trim().length < 80}>{working === "classify" ? "判断中..." : draft.classifiedAt ? "重新自动判断" : "现在自动判断"}</button>
              </div>
              {draft.classifiedAt ? <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white px-3 py-1 text-[#174d73]">{draft.difficulty}</span><span className="rounded-full bg-white px-3 py-1 text-[#174d73]">CEFR {draft.cefr}</span>{draft.topics.map((topic) => <span key={topic} className="rounded-full bg-white px-3 py-1 text-[#174d73]">{topic}</span>)}<span className="rounded-full bg-white px-3 py-1 text-[#174d73]">{draft.wordCount.toLocaleString("zh-CN")} 词</span></div> : <p className="mt-3 text-sm text-[#4d6577]">尚未判断，保存候选时会自动完成。</p>}
              {draft.classifiedAt && <p className="mt-3 text-xs leading-5 text-[#4d6577]">适合：{draft.audienceStages.join("、")}；{draft.timeliness === "time-sensitive" ? "发布前需要检查时效" : "内容长期有效"}{draft.reviewNotes ? `；${draft.reviewNotes}` : ""}</p>}
            </div>

            <div className="mt-6 border-t border-[#e1e5e9] pt-5">
              <button className={primaryButtonClass} type="button" onClick={handleSave} disabled={busy || !draft.title.trim() || draft.body.trim().length < 80}>{working === "save" || working === "classify" ? "正在整理并保存..." : draft.id ? "保存候选修改" : "保存到候选库"}</button>
            </div>
          </div>
        </div>
        </section>

        <section ref={candidateSectionRef} className="scroll-mt-5 rounded-2xl bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#17191c]">候选文章</h2>
            <p className="mt-1 text-sm leading-6 text-[#4d535a]">先预览，再选择发布。共 {candidates.length} 篇，其中 {missingCoverCount} 篇还需要补充封面。</p>
          </div>
          <div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} type="button" onClick={() => void loadCandidates()} disabled={busy || loadingCandidates}>刷新候选</button><button className={primaryButtonClass} type="button" onClick={handleBatchPublish} disabled={busy || selectedIds.length === 0}>发布选中 ({selectedIds.length})</button></div>
        </div>

        {loadingCandidates ? <p className="mt-5 text-sm text-[#59636c]">正在读取候选文章...</p> : candidates.length === 0 ? <p className="mt-5 rounded-xl bg-[#f3f5f7] px-4 py-5 text-sm leading-6 text-[#59636c]">还没有候选文章。请从本地文章、粘贴正文或 URL 建立第一篇候选。</p> : (
          <ul ref={candidateListRef} className="mt-5 max-h-[min(70vh,760px)] divide-y divide-[#e1e5e9] overflow-y-auto overscroll-contain scroll-smooth border-y border-[#e1e5e9] pr-2" aria-label="候选文章列表" tabIndex={0}>
            {candidates.map((article) => {
              const recommendation = article.recommendation;
              const hasCover = Boolean(recommendation?.coverImageUrl?.trim());
              const selected = selectedIds.includes(article.id);
              const isRecent = recentCandidateIds.includes(article.id);
              return <li key={article.id} data-candidate-id={article.id} tabIndex={-1} className={`grid gap-4 px-2 py-4 outline-none transition-colors focus:bg-[#edf5fb] sm:grid-cols-[auto_112px_minmax(0,1fr)_auto] sm:items-center ${isRecent ? "bg-[#edf5fb]" : "bg-white"}`}>
                <input className="h-5 w-5 accent-[#1769aa]" type="checkbox" checked={selected} disabled={!hasCover || busy} aria-label={`选择 ${article.title}`} onChange={() => setSelectedIds((ids) => selected ? ids.filter((id) => id !== article.id) : [...ids, article.id])} />
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-[#e8edf1]">{hasCover ? <img className="h-full w-full object-cover" src={recommendation?.coverImageUrl} alt="" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-[#6a4a43]">缺少封面</div>}</div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold leading-6 text-[#17191c]">{article.title}</h3>{isRecent && <span className="rounded-full bg-[#1769aa] px-2.5 py-1 text-xs font-medium text-white">本次新增</span>}<span className={`rounded-full px-2.5 py-1 text-xs font-medium ${hasCover ? "bg-[#e9f5ee] text-[#17613b]" : "bg-[#fff0ed] text-[#9b3524]"}`}>{hasCover ? "可发布" : "待补封面"}</span>{recommendation?.sourceKind === "crawler" && <span className="rounded-full bg-[#edf5fb] px-2.5 py-1 text-xs font-medium text-[#174d73]">自动发现</span>}{recommendation?.sourceKind === "local-saved" && <span className="rounded-full bg-[#eef1f4] px-2.5 py-1 text-xs font-medium text-[#4d535a]">本地文章</span>}</div><p className="mt-1 line-clamp-2 text-sm leading-6 text-[#4d535a]">{article.summary || "暂无摘要"}</p><p className="mt-1 text-xs leading-5 text-[#68717a]">{recommendation?.difficulty || "待判断"} · CEFR {recommendation?.cefr || "待判断"} · {recommendation?.topics.join("、") || "待分类"} · {(recommendation?.wordCount ?? countArticleEnglishWords(article.body)).toLocaleString("zh-CN")} 词</p><p className="mt-0.5 text-xs leading-5 text-[#7b848c]">适合：{recommendation?.audienceStages.join("、") || "待判断"} · {recommendation?.timeliness === "time-sensitive" ? "需检查时效" : "长期有效"} · {article.sourceName || "来源待确认"}</p></div>
                <div className="flex flex-wrap gap-2 sm:justify-end"><button className={secondaryButtonClass} type="button" onClick={() => onOpenArticle(article)} disabled={busy}>打开并编辑正文</button><button className={secondaryButtonClass} type="button" onClick={() => { setDraft(draftFromCandidate(article)); setMode(article.recommendation?.sourceKind === "local-saved" ? "local" : article.recommendation?.sourceKind === "manual-paste" ? "paste" : "url"); setSelectedLocalArticleId(""); setError(""); setMessage(""); editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} disabled={busy}>编辑资料与封面</button><button className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-45" type="button" onClick={() => void handleDeleteCandidate(article)} disabled={busy}>删除</button></div>
              </li>;
            })}
          </ul>
        )}
        </section>

      </div>
    </>
  );
}
