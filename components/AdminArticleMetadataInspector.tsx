"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ClearableField from "@/components/ClearableField";
import { countArticleEnglishWords } from "@/lib/articleWordCount";
import { EDITORIAL_CATEGORIES, editorialCategoryForArticle, type EditorialCategory } from "@/lib/editorialCuration";
import {
  ARTICLE_AUDIENCE_STAGES, ARTICLE_CEFR_LEVELS, ARTICLE_DIFFICULTIES, ARTICLE_TOPICS,
  type ArticleAudienceStage, type ArticleCefrLevel, type ArticleDifficulty, type ArticleManualField,
  type ArticleRecommendationMetadata, type ArticleTimeliness, type ArticleTopic, type PublicArticle,
} from "@/types/publicArticle";

interface ClassificationResponse {
  summary: string; difficulty: ArticleDifficulty; cefr: ArticleCefrLevel; audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[]; wordCount: number; timeliness: ArticleTimeliness; reviewNotes: string;
  classificationSource: "model" | "heuristic"; classifiedAt: string;
  difficultyEvidence: NonNullable<ArticleRecommendationMetadata["difficultyEvidence"]>; warning?: string;
}

interface InspectorProps {
  article: PublicArticle;
  articleKind: "candidate" | "published";
  queuePosition?: { index: number; total: number };
  onSave: (summary: string, recommendation: ArticleRecommendationMetadata) => Promise<void>;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onSelect?: (category: EditorialCategory, featured: boolean) => Promise<void>;
  onReject?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

interface InspectorDraft {
  summary: string; difficulty: ArticleDifficulty; cefr: ArticleCefrLevel; audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[]; homepageCategory: EditorialCategory; timeliness: ArticleTimeliness; reviewNotes: string;
  recommendation: ArticleRecommendationMetadata;
}

const inputClass = "mt-1.5 w-full rounded-lg border border-[#c9ced6] bg-white px-3 py-2 text-sm text-[#17191c] outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15 disabled:bg-[#f0f2f4]";
const labelClass = "block text-xs font-semibold leading-5 text-[#46525c]";

function initialRecommendation(article: PublicArticle): ArticleRecommendationMetadata {
  const existing = article.recommendation ?? article.importedArticle?.recommendation;
  return {
    coverImageUrl: existing?.coverImageUrl ?? "", coverImageAlt: existing?.coverImageAlt ?? article.title,
    coverImageSourceUrl: existing?.coverImageSourceUrl ?? article.sourceUrl, coverImageCredit: existing?.coverImageCredit ?? "",
    difficulty: existing?.difficulty ?? "高中 / CET-4", cefr: existing?.cefr ?? "B2",
    audienceStages: existing?.audienceStages ?? ["高中", "CET-4"], topics: existing?.topics ?? ["社会生活"],
    homepageCategory: existing?.homepageCategory, wordCount: countArticleEnglishWords(article.body),
    timeliness: existing?.timeliness ?? "evergreen", sourceKind: existing?.sourceKind ?? (article.sourceUrl ? "manual-url" : "manual-paste"),
    classificationSource: existing?.classificationSource ?? "heuristic", classifiedAt: existing?.classifiedAt,
    reviewNotes: existing?.reviewNotes ?? "", difficultyEvidence: existing?.difficultyEvidence, manualFields: existing?.manualFields ?? [],
  };
}

function initialDraft(article: PublicArticle): InspectorDraft {
  const recommendation = initialRecommendation(article);
  return {
    summary: article.summary, difficulty: recommendation.difficulty, cefr: recommendation.cefr,
    audienceStages: recommendation.audienceStages, topics: recommendation.topics,
    homepageCategory: editorialCategoryForArticle(article), timeliness: recommendation.timeliness,
    reviewNotes: recommendation.reviewNotes ?? "", recommendation,
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function draftSignature(draft: InspectorDraft): string {
  return JSON.stringify({ summary: draft.summary, difficulty: draft.difficulty, cefr: draft.cefr,
    audienceStages: draft.audienceStages, topics: draft.topics, homepageCategory: draft.homepageCategory,
    timeliness: draft.timeliness, reviewNotes: draft.reviewNotes });
}

export default function AdminArticleMetadataInspector(props: InspectorProps) {
  const { article, articleKind, queuePosition, onSave, onPrevious, onNext, onClose, onSelect, onReject, onDelete } = props;
  const [draft, setDraft] = useState(() => initialDraft(article));
  const [baseline, setBaseline] = useState(() => initialDraft(article));
  const [working, setWorking] = useState<"" | "save" | "classify" | "select" | "reject" | "delete">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [featured, setFeatured] = useState(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const next = initialDraft(article);
    setDraft(next); setBaseline(next); setFeatured(false); setMessage(""); setError("");
  }, [article]);

  const wordCount = useMemo(() => countArticleEnglishWords(article.body), [article.body]);
  const evidence = draft.recommendation.difficultyEvidence;
  const dirty = draftSignature(draft) !== draftSignature(baseline);

  function toggleAudience(stage: ArticleAudienceStage) {
    setDraft((current) => ({ ...current, audienceStages: current.audienceStages.includes(stage)
      ? current.audienceStages.filter((item) => item !== stage) : [...current.audienceStages, stage].slice(0, 4) }));
  }

  function toggleTopic(topic: ArticleTopic) {
    setDraft((current) => ({ ...current, topics: current.topics.includes(topic)
      ? current.topics.filter((item) => item !== topic) : [...current.topics, topic].slice(0, 3) }));
  }

  function buildRecommendation(current: InspectorDraft): ArticleRecommendationMetadata {
    const changedFields: ArticleManualField[] = [
      ...(current.summary !== baseline.summary ? ["summary" as const] : []),
      ...(current.difficulty !== baseline.difficulty ? ["difficulty" as const] : []),
      ...(current.cefr !== baseline.cefr ? ["cefr" as const] : []),
      ...(!sameArray(current.audienceStages, baseline.audienceStages) ? ["audienceStages" as const] : []),
      ...(!sameArray(current.topics, baseline.topics) ? ["topics" as const] : []),
      ...(current.homepageCategory !== baseline.homepageCategory ? ["homepageCategory" as const] : []),
      ...(current.timeliness !== baseline.timeliness ? ["timeliness" as const] : []),
      ...(current.reviewNotes !== baseline.reviewNotes ? ["reviewNotes" as const] : []),
    ];
    const manualFields = [...new Set([...(current.recommendation.manualFields ?? []), ...changedFields])];
    return { ...current.recommendation, difficulty: current.difficulty, cefr: current.cefr,
      audienceStages: current.audienceStages, topics: current.topics, homepageCategory: current.homepageCategory,
      wordCount, timeliness: current.timeliness, reviewNotes: current.reviewNotes.trim(),
      classificationSource: manualFields.length ? "manual" : current.recommendation.classificationSource,
      ...(manualFields.length ? { manualFields } : {}) };
  }

  async function saveDraft(showMessage = false): Promise<void> {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!dirty) return;
    if (!draft.audienceStages.length || !draft.topics.length) throw new Error("适合人群和文章类型至少各选择一项。");
    const current = draft;
    const recommendation = buildRecommendation(current);
    setWorking("save"); setError("");
    const promise = onSave(current.summary.trim(), recommendation)
      .then(() => { const next = { ...current, recommendation }; setDraft(next); setBaseline(next); if (showMessage) setMessage("资料已保存。"); })
      .catch((saveError) => { const text = saveError instanceof Error ? saveError.message : "文章资料保存失败。"; setError(text); throw saveError; })
      .finally(() => { savePromiseRef.current = null; setWorking(""); });
    savePromiseRef.current = promise;
    return promise;
  }

  useEffect(() => {
    if (!dirty || working === "classify" || working === "select" || working === "reject") return;
    const timer = window.setTimeout(() => void saveDraft(false).catch(() => undefined), 850);
    return () => window.clearTimeout(timer);
  }, [dirty, draft]);

  async function handleReclassify() {
    setWorking("classify"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/article-classification", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: article.title, text: article.body, sourceUrl: article.sourceUrl, sourceName: article.sourceName }) });
      const data = await response.json().catch(() => null) as { classification?: ClassificationResponse; error?: string } | null;
      if (!response.ok || !data?.classification) throw new Error(data?.error || "难度证据分析失败。");
      const classification = data.classification;
      const locked = new Set(draft.recommendation.manualFields ?? []);
      setDraft((current) => ({ ...current,
        summary: locked.has("summary") ? current.summary : classification.summary,
        difficulty: locked.has("difficulty") ? current.difficulty : classification.difficulty,
        cefr: locked.has("cefr") ? current.cefr : classification.cefr,
        audienceStages: locked.has("audienceStages") ? current.audienceStages : classification.audienceStages,
        topics: locked.has("topics") ? current.topics : classification.topics,
        timeliness: locked.has("timeliness") ? current.timeliness : classification.timeliness,
        reviewNotes: locked.has("reviewNotes") ? current.reviewNotes : classification.reviewNotes,
        recommendation: { ...current.recommendation, wordCount: classification.wordCount,
          classifiedAt: classification.classifiedAt, difficultyEvidence: classification.difficultyEvidence,
          classificationSource: locked.size ? "manual" : classification.classificationSource } }));
      setMessage(classification.warning || "证据已更新，随后会自动保存。");
    } catch (classifyError) { setError(classifyError instanceof Error ? classifyError.message : "难度证据分析失败。"); }
    finally { setWorking(""); }
  }

  async function handleSelect() {
    if (!onSelect) return;
    setWorking("select"); setError("");
    try { await saveDraft(); setWorking("select"); await onSelect(draft.homepageCategory, featured); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "精选失败。"); setWorking(""); }
  }

  async function handleReject() {
    if (!onReject) return;
    setWorking("reject"); setError("");
    try { await saveDraft(); setWorking("reject"); await onReject(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "移出候选失败。"); setWorking(""); }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setWorking("delete"); setError("");
    try { await saveDraft(); setWorking("delete"); await onDelete(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "删除精选失败。"); setWorking(""); }
  }

  const busy = Boolean(working);
  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[330px] flex-col border-r border-[#d7dde2] bg-[#f7f9fa] text-[#17212b]">
      <div className="shrink-0 border-b border-[#d7dde2] bg-[#f7f9fa] px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2"><button className="text-sm font-semibold text-[#1769aa]" type="button" onClick={onClose}>返回后台</button><span className="text-xs text-[#68737c]">{working === "save" ? "正在保存…" : dirty ? "等待自动保存" : "已保存"}</span></div>
        <div className="mt-3 flex items-center justify-between gap-2"><button className="h-9 rounded-full bg-white px-3 text-sm disabled:opacity-35" type="button" onClick={onPrevious} disabled={!onPrevious || busy}>← 上一篇</button><span className="text-xs font-medium text-[#4d5963]">{queuePosition ? `${queuePosition.index + 1} / ${queuePosition.total}` : articleKind === "candidate" ? "候选" : "已精选"}</span><button className="h-9 rounded-full bg-white px-3 text-sm disabled:opacity-35" type="button" onClick={onNext} disabled={!onNext || busy}>下一篇 →</button></div>
        {articleKind === "candidate" && <div className="mt-3 grid grid-cols-2 gap-2"><button className="min-h-11 rounded-lg bg-[#1769aa] px-3 text-sm font-semibold text-white disabled:bg-[#9fb5c5]" type="button" onClick={() => void handleSelect()} disabled={busy}>{working === "select" ? "正在精选…" : "精选并继续"}</button><button className="min-h-11 rounded-lg border border-[#d5a7a7] bg-white px-3 text-sm font-semibold text-[#9a3030] disabled:opacity-45" type="button" onClick={() => void handleReject()} disabled={busy}>{working === "reject" ? "正在移出…" : "不精选"}</button></div>}
        {articleKind === "candidate" && !article.recommendation?.coverImageUrl?.trim() && <p className="mt-2 text-xs leading-5 text-[#526873]">无图候选：仍可精选，首页会使用纯文本外刊卡片。</p>}
        {articleKind === "published" && onDelete && <button className="mt-3 min-h-11 w-full rounded-lg border border-[#d5a7a7] bg-white px-3 text-sm font-semibold text-[#9a3030] disabled:opacity-45" type="button" onClick={() => void handleDelete()} disabled={busy}>{working === "delete" ? "正在删除…" : "删除这篇精选"}</button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="text-xs font-semibold text-[#1769aa]">{articleKind === "candidate" ? "候选文章" : "已公开推荐"}</p><h1 className="mt-1 text-base font-semibold leading-6">{article.title}</h1><p className="mt-1 text-xs leading-5 text-[#68737c]">{article.sourceName || "来源待确认"} · {wordCount.toLocaleString("zh-CN")} 词</p>
        <div className="mt-4 grid gap-3">
          <label className={labelClass}>首页栏目<select className={inputClass} value={draft.homepageCategory} onChange={(event) => setDraft((current) => ({ ...current, homepageCategory: event.target.value as EditorialCategory }))} disabled={busy}>{EDITORIAL_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          {articleKind === "candidate" && <label className="flex items-start gap-2 rounded-lg bg-white p-3 text-xs leading-5 text-[#46525c]"><input className="mt-1" type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} disabled={busy} /><span><strong className="block text-[#17212b]">设为本栏主推</strong>精选后放到“{draft.homepageCategory}”第一篇；不勾选则排在当前主推之后。</span></label>}
          <label className={labelClass}>难度档位<select className={inputClass} value={draft.difficulty} onChange={(event) => setDraft((current) => ({ ...current, difficulty: event.target.value as ArticleDifficulty }))} disabled={busy}>{ARTICLE_DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className={labelClass}>CEFR 辅助等级<select className={inputClass} value={draft.cefr} onChange={(event) => setDraft((current) => ({ ...current, cefr: event.target.value as ArticleCefrLevel }))} disabled={busy}>{ARTICLE_CEFR_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <fieldset><legend className={labelClass}>文章类型</legend><div className="mt-2 flex flex-wrap gap-1.5">{ARTICLE_TOPICS.map((topic) => <button key={topic} className={`rounded-full px-2.5 py-1.5 text-xs ${draft.topics.includes(topic) ? "bg-[#1769aa] text-white" : "bg-white text-[#46525c]"}`} type="button" aria-pressed={draft.topics.includes(topic)} onClick={() => toggleTopic(topic)} disabled={busy}>{topic}</button>)}</div></fieldset>
        </div>

        <details className="mt-4 border-t border-[#d7dde2] pt-3"><summary className="cursor-pointer text-sm font-semibold">文章梗概与发布依据</summary><div className="mt-3 grid gap-3"><label className={labelClass}>中文摘要<ClearableField value={draft.summary} onClear={() => setDraft((current) => ({ ...current, summary: "" }))} label="清空中文摘要" disabled={busy} multiline><textarea className={`${inputClass} min-h-28 resize-y leading-6`} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} maxLength={1000} disabled={busy} /></ClearableField></label><label className={labelClass}>发布前备注<ClearableField value={draft.reviewNotes} onClear={() => setDraft((current) => ({ ...current, reviewNotes: "" }))} label="清空发布前备注" disabled={busy} multiline><textarea className={`${inputClass} min-h-20 resize-y leading-6`} value={draft.reviewNotes} onChange={(event) => setDraft((current) => ({ ...current, reviewNotes: event.target.value }))} maxLength={500} disabled={busy} /></ClearableField></label><label className={labelClass}>时效性<select className={inputClass} value={draft.timeliness} onChange={(event) => setDraft((current) => ({ ...current, timeliness: event.target.value as ArticleTimeliness }))} disabled={busy}><option value="evergreen">长期有效</option><option value="time-sensitive">发布前需检查时效</option></select></label></div></details>
        <details className="mt-3 border-t border-[#d7dde2] pt-3"><summary className="cursor-pointer text-sm font-semibold">适合人群</summary><div className="mt-3 flex flex-wrap gap-1.5">{ARTICLE_AUDIENCE_STAGES.map((stage) => <button key={stage} className={`rounded-full px-2.5 py-1.5 text-xs ${draft.audienceStages.includes(stage) ? "bg-[#1769aa] text-white" : "bg-white text-[#46525c]"}`} type="button" aria-pressed={draft.audienceStages.includes(stage)} onClick={() => toggleAudience(stage)} disabled={busy}>{stage}</button>)}</div></details>
        <details className="mt-3 border-t border-[#d7dde2] pt-3"><summary className="cursor-pointer text-sm font-semibold">难度证据 <span className="font-normal text-[#68737c]">{evidence ? `· ${evidence.confidence}` : "· 尚未分析"}</span></summary>{evidence ? <div className="mt-3 space-y-2 text-xs leading-5 text-[#4d5963]"><p>{evidence.sourcePrior}</p><p>平均句长 {evidence.averageSentenceLength} 词，长词 {Math.round(evidence.longWordRatio * 100)}%，复杂句信号 {Math.round(evidence.complexSentenceRatio * 100)}%。</p>{evidence.challengingTerms.length > 0 && <p>代表性难词：{evidence.challengingTerms.join("、")}</p>}<p className="text-[#294f6b]">{evidence.rationale}</p></div> : <p className="mt-2 text-xs leading-5 text-[#68737c]">可重新按词汇、句法、抽象度与背景知识分析。</p>}<button className="mt-3 w-full rounded-full border border-[#1769aa] px-3 py-2 text-sm font-medium text-[#1769aa] disabled:opacity-45" type="button" onClick={() => void handleReclassify()} disabled={busy}>{working === "classify" ? "正在分析…" : "重新分析证据"}</button></details>
        {(message || error) && <p className={`mt-4 rounded-lg px-3 py-2 text-xs leading-5 ${error ? "bg-red-50 text-red-700" : "bg-[#e9f5ee] text-[#17613b]"}`} role={error ? "alert" : "status"}>{error || message}</p>}
        <button className="mt-4 w-full rounded-full border border-[#1769aa] bg-white px-4 py-2.5 text-sm font-semibold text-[#1769aa] disabled:opacity-45" type="button" onClick={() => void saveDraft(true)} disabled={busy || !dirty}>{working === "save" ? "正在保存…" : dirty ? "立即保存" : "已经自动保存"}</button>
      </div>
    </aside>
  );
}
