"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportedArticle } from "@/types/article";
import {
  ARTICLE_AUDIENCE_STAGES,
  ARTICLE_CEFR_LEVELS,
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleAudienceStage,
  type ArticleCefrLevel,
  type ArticleDifficulty,
  type ArticleRecommendationMetadata,
  type ArticleTimeliness,
  type ArticleTopic,
  type PublicArticle,
  type PublicArticleCandidateInput,
} from "@/types/publicArticle";

interface ClassificationResponse {
  summary: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  readingMinutes: number;
  timeliness: ArticleTimeliness;
  reviewNotes: string;
  classificationSource: "model" | "heuristic";
  classifiedAt: string;
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
  readingMinutes: number;
  timeliness: ArticleTimeliness;
  classificationSource: "model" | "heuristic" | "manual";
  classifiedAt: string;
  reviewNotes: string;
  sourceKind: "manual-paste" | "manual-url";
}

interface AdminArticleIntakePanelProps {
  onPublished?: () => void | Promise<void>;
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
  readingMinutes: 1,
  timeliness: "evergreen",
  classificationSource: "manual",
  classifiedAt: "",
  reviewNotes: "",
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
    readingMinutes: Math.max(1, Math.round(draft.readingMinutes || 1)),
    timeliness: draft.timeliness,
    sourceKind: draft.sourceKind,
    classificationSource: draft.classificationSource,
    classifiedAt: draft.classifiedAt || new Date().toISOString(),
    reviewNotes: draft.reviewNotes.trim(),
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
    readingMinutes: recommendation?.readingMinutes ?? Math.max(1, Math.ceil(article.body.split(/\s+/).length / 180)),
    timeliness: recommendation?.timeliness ?? "evergreen",
    classificationSource: recommendation?.classificationSource ?? "manual",
    classifiedAt: recommendation?.classifiedAt ?? "",
    reviewNotes: recommendation?.reviewNotes ?? "",
    sourceKind: recommendation?.sourceKind === "manual-url" ? "manual-url" : "manual-paste",
  };
}

export default function AdminArticleIntakePanel({ onPublished }: AdminArticleIntakePanelProps) {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [candidates, setCandidates] = useState<PublicArticle[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [working, setWorking] = useState<"" | "import" | "classify" | "save" | "publish" | "upload">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    void loadCandidates();
  }, []);

  function resetDraft(nextMode: "paste" | "url" = mode) {
    setDraft({ ...EMPTY_DRAFT, sourceKind: nextMode === "url" ? "manual-url" : "manual-paste" });
    setMode(nextMode);
    setUrl("");
    setMessage("");
    setError("");
  }

  function applyClassification(base: DraftState, classification: ClassificationResponse): DraftState {
    return {
      ...base,
      summary: classification.summary,
      difficulty: classification.difficulty,
      cefr: classification.cefr,
      audienceStages: classification.audienceStages,
      topics: classification.topics,
      readingMinutes: classification.readingMinutes,
      timeliness: classification.timeliness,
      classificationSource: classification.classificationSource,
      classifiedAt: classification.classifiedAt,
      reviewNotes: classification.reviewNotes,
    };
  }

  async function classifyDraft(base: DraftState): Promise<DraftState> {
    setWorking("classify");
    const response = await fetch("/api/admin/article-classification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: base.title, text: base.body }),
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
        throw new Error(data?.error || "URL 导入失败。");
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
        readingMinutes: Math.max(1, Math.ceil(data.article.text.split(/\s+/).length / 180)),
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
      setError(importError instanceof Error ? importError.message : "URL 导入失败。");
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

  async function handlePublishCurrent() {
    setError("");
    setMessage("");
    if (!draft.coverImageUrl.trim()) {
      setError("推荐封面是发布必需项，请先选择或上传封面。正文配图不作要求。");
      return;
    }
    try {
      const saved = await saveCandidate();
      const articles = await publishIds([saved.id]);
      setMessage(`《${articles[0]?.title || saved.title}》已发布到推荐目录。`);
      resetDraft(mode);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "候选文章发布失败。");
    } finally {
      setWorking("");
    }
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

  function toggleTopic(topic: ArticleTopic) {
    setDraft((current) => {
      const exists = current.topics.includes(topic);
      if (exists && current.topics.length === 1) return current;
      if (!exists && current.topics.length >= 3) return current;
      return { ...current, topics: exists ? current.topics.filter((item) => item !== topic) : [...current.topics, topic], classificationSource: "manual" };
    });
  }

  function toggleAudience(stage: ArticleAudienceStage) {
    setDraft((current) => {
      const exists = current.audienceStages.includes(stage);
      if (exists && current.audienceStages.length === 1) return current;
      if (!exists && current.audienceStages.length >= 4) return current;
      return { ...current, audienceStages: exists ? current.audienceStages.filter((item) => item !== stage) : [...current.audienceStages, stage], classificationSource: "manual" };
    });
  }

  const busy = Boolean(working);

  return (
    <div className="grid gap-5">
      {(message || error) && (
        <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${error ? "border-red-200 bg-red-50 text-red-800" : "border-[#bfd4e5] bg-[#edf5fb] text-[#174d73]"}`} role={error ? "alert" : "status"}>
          {error || message}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white">
        <div className="border-b border-[#e1e5e9] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#17191c]">添加推荐文章</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#4d535a]">粘贴文章和输入 URL 是同级入口。URL 会保留有效正文配图，并自动判断难度、适合人群和兴趣类型。</p>
            </div>
            <button className={secondaryButtonClass} type="button" onClick={() => resetDraft(mode)} disabled={busy}>清空当前内容</button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[#eef1f4] p-1" aria-label="文章录入方式">
            <button className={`min-h-10 rounded-lg px-4 text-sm font-medium transition ${mode === "paste" ? "bg-white text-[#17191c]" : "text-[#4d535a] hover:text-[#17191c]"}`} type="button" aria-pressed={mode === "paste"} onClick={() => resetDraft("paste")}>粘贴文章</button>
            <button className={`min-h-10 rounded-lg px-4 text-sm font-medium transition ${mode === "url" ? "bg-white text-[#17191c]" : "text-[#4d535a] hover:text-[#17191c]"}`} type="button" aria-pressed={mode === "url"} onClick={() => resetDraft("url")}>输入 URL</button>
          </div>
        </div>

        <div ref={editorRef} className="grid gap-6 px-5 py-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:px-6">
          <div className="min-w-0">
            {mode === "url" ? (
              <div>
                <label className={labelClass} htmlFor="admin-article-url">文章 URL</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input id="admin-article-url" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#c9ced6] bg-white px-3.5 text-[15px] outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" disabled={busy} />
                  <button className={primaryButtonClass} type="button" onClick={handleImportUrl} disabled={busy}>{working === "import" || working === "classify" ? "读取并判断中..." : "读取并判断文章"}</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <label className={labelClass}>文章标题<input className={inputClass} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, coverImageAlt: current.coverImageAlt || event.target.value }))} maxLength={200} placeholder="输入英文文章标题" disabled={busy} /></label>
                <label className={labelClass}>英文正文<textarea className={`${inputClass} min-h-72 resize-y leading-7`} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value, importedArticle: null, classifiedAt: "" }))} placeholder="粘贴完整英文文章" disabled={busy} /></label>
                <button className={secondaryButtonClass} type="button" onClick={handleClassify} disabled={busy || !draft.title.trim() || draft.body.trim().length < 80}>{working === "classify" ? "正在判断..." : "自动判断难度与类型"}</button>
              </div>
            )}

            {mode === "url" && draft.body && (
              <div className="mt-5 rounded-xl bg-[#f3f5f7] p-4">
                <p className="font-medium text-[#17191c]">{draft.title}</p>
                <p className="mt-1 text-sm text-[#4d535a]">{draft.sourceName}，正文 {draft.body.length.toLocaleString("zh-CN")} 字符，保留 {draft.importedArticle?.blocks.filter((block) => block.type === "image").length ?? 0} 张正文配图</p>
              </div>
            )}

            <div className="mt-6 grid gap-4">
              <label className={labelClass}>推荐摘要<textarea className={`${inputClass} min-h-24 resize-y leading-6`} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} maxLength={1000} placeholder="用于封面旁边的文章摘要" disabled={busy} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>来源名称<input className={inputClass} value={draft.sourceName} onChange={(event) => setDraft((current) => ({ ...current, sourceName: event.target.value }))} maxLength={200} disabled={busy} /></label>
                <label className={labelClass}>来源 URL<input className={inputClass} value={draft.sourceUrl} onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))} maxLength={2048} disabled={busy} /></label>
              </div>
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
              <label className={labelClass}>封面图片 URL<input className={inputClass} type="url" value={draft.coverImageUrl} onChange={(event) => setDraft((current) => ({ ...current, coverImageUrl: event.target.value }))} placeholder="抓取结果或公开图片地址" disabled={busy} /></label>
              <label className={labelClass}>上传封面图片<input className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[#edf5fb] file:px-3 file:py-1.5 file:text-sm file:text-[#175a8d]`} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void handleCoverUpload(event.target.files?.[0] ?? null)} disabled={busy} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>图片说明<input className={inputClass} value={draft.coverImageAlt} onChange={(event) => setDraft((current) => ({ ...current, coverImageAlt: event.target.value }))} maxLength={300} disabled={busy} /></label>
                <label className={labelClass}>图片署名<input className={inputClass} value={draft.coverImageCredit} onChange={(event) => setDraft((current) => ({ ...current, coverImageCredit: event.target.value }))} maxLength={300} placeholder="作者或来源" disabled={busy} /></label>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <label className={labelClass}>难度<select className={inputClass} value={draft.difficulty} onChange={(event) => setDraft((current) => ({ ...current, difficulty: event.target.value as ArticleDifficulty, classificationSource: "manual" }))} disabled={busy}>{ARTICLE_DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className={labelClass}>CEFR<select className={inputClass} value={draft.cefr} onChange={(event) => setDraft((current) => ({ ...current, cefr: event.target.value as ArticleCefrLevel, classificationSource: "manual" }))} disabled={busy}>{ARTICLE_CEFR_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className={labelClass}>阅读时间（分钟）<input className={inputClass} type="number" min={1} max={240} value={draft.readingMinutes} onChange={(event) => setDraft((current) => ({ ...current, readingMinutes: Number(event.target.value) || 1 }))} disabled={busy} /></label>
            </div>

            <fieldset className="mt-5"><legend className="text-sm font-medium text-[#343a40]">适合人群，最多 4 项</legend><div className="mt-2 flex flex-wrap gap-2">{ARTICLE_AUDIENCE_STAGES.map((stage) => <label key={stage} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${draft.audienceStages.includes(stage) ? "border-[#1769aa] bg-[#edf5fb] text-[#174d73]" : "border-[#d5d9de] text-[#4d535a]"}`}><input className="sr-only" type="checkbox" checked={draft.audienceStages.includes(stage)} onChange={() => toggleAudience(stage)} />{stage}</label>)}</div></fieldset>
            <fieldset className="mt-5"><legend className="text-sm font-medium text-[#343a40]">兴趣类型，最多 3 项</legend><div className="mt-2 flex flex-wrap gap-2">{ARTICLE_TOPICS.map((topic) => <label key={topic} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${draft.topics.includes(topic) ? "border-[#1769aa] bg-[#edf5fb] text-[#174d73]" : "border-[#d5d9de] text-[#4d535a]"}`}><input className="sr-only" type="checkbox" checked={draft.topics.includes(topic)} onChange={() => toggleTopic(topic)} />{topic}</label>)}</div></fieldset>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>时效属性<select className={inputClass} value={draft.timeliness} onChange={(event) => setDraft((current) => ({ ...current, timeliness: event.target.value as ArticleTimeliness, classificationSource: "manual" }))} disabled={busy}><option value="evergreen">长期有效</option><option value="time-sensitive">需要检查时效</option></select></label>
              <label className={labelClass}>审核备注<input className={inputClass} value={draft.reviewNotes} onChange={(event) => setDraft((current) => ({ ...current, reviewNotes: event.target.value }))} maxLength={500} disabled={busy} /></label>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-[#e1e5e9] pt-5">
              <button className={secondaryButtonClass} type="button" onClick={handleSave} disabled={busy || !draft.title.trim() || draft.body.trim().length < 80}>{working === "save" ? "保存中..." : draft.id ? "保存候选修改" : "保存为候选"}</button>
              <button className={primaryButtonClass} type="button" onClick={handlePublishCurrent} disabled={busy || !draft.title.trim() || draft.body.trim().length < 80}>{working === "publish" ? "发布中..." : "保存并发布推荐"}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#17191c]">候选文章</h2>
            <p className="mt-1 text-sm leading-6 text-[#4d535a]">共 {candidates.length} 篇，其中 {missingCoverCount} 篇缺少推荐封面。缺封面文章会留在这里提醒你补充。</p>
          </div>
          <div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} type="button" onClick={() => void loadCandidates()} disabled={busy || loadingCandidates}>刷新候选</button><button className={primaryButtonClass} type="button" onClick={handleBatchPublish} disabled={busy || selectedIds.length === 0}>发布选中 ({selectedIds.length})</button></div>
        </div>

        {loadingCandidates ? <p className="mt-5 text-sm text-[#59636c]">正在读取候选文章...</p> : candidates.length === 0 ? <p className="mt-5 rounded-xl bg-[#f3f5f7] px-4 py-5 text-sm leading-6 text-[#59636c]">还没有候选文章。可以从上方粘贴文章，或输入一个公开 URL。</p> : (
          <ul className="mt-5 divide-y divide-[#e1e5e9]">
            {candidates.map((article) => {
              const recommendation = article.recommendation;
              const hasCover = Boolean(recommendation?.coverImageUrl?.trim());
              const selected = selectedIds.includes(article.id);
              return <li key={article.id} className="grid gap-4 py-4 sm:grid-cols-[auto_112px_minmax(0,1fr)_auto] sm:items-center">
                <input className="h-5 w-5 accent-[#1769aa]" type="checkbox" checked={selected} disabled={!hasCover || busy} aria-label={`选择 ${article.title}`} onChange={() => setSelectedIds((ids) => selected ? ids.filter((id) => id !== article.id) : [...ids, article.id])} />
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-[#e8edf1]">{hasCover ? <img className="h-full w-full object-cover" src={recommendation?.coverImageUrl} alt="" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-[#6a4a43]">缺少封面</div>}</div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold leading-6 text-[#17191c]">{article.title}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${hasCover ? "bg-[#e9f5ee] text-[#17613b]" : "bg-[#fff0ed] text-[#9b3524]"}`}>{hasCover ? "可发布" : "待补封面"}</span></div><p className="mt-1 line-clamp-2 text-sm leading-6 text-[#4d535a]">{article.summary || "暂无摘要"}</p><p className="mt-1 text-xs leading-5 text-[#68717a]">{recommendation?.difficulty || "待判断"} · {recommendation?.topics.join("、") || "待分类"} · {recommendation?.readingMinutes || 1} 分钟</p></div>
                <div className="flex flex-wrap gap-2 sm:justify-end"><button className={secondaryButtonClass} type="button" onClick={() => { setDraft(draftFromCandidate(article)); setMode(article.recommendation?.sourceKind === "manual-url" ? "url" : "paste"); setError(""); setMessage(""); editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} disabled={busy}>编辑</button><button className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-45" type="button" onClick={() => void handleDeleteCandidate(article)} disabled={busy}>删除</button></div>
              </li>;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
