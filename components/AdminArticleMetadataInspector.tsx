"use client";

import { useEffect, useMemo, useState } from "react";
import ClearableField from "@/components/ClearableField";
import { countArticleEnglishWords } from "@/lib/articleWordCount";
import {
  ARTICLE_AUDIENCE_STAGES,
  ARTICLE_CEFR_LEVELS,
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleAudienceStage,
  type ArticleCefrLevel,
  type ArticleDifficulty,
  type ArticleManualField,
  type ArticleRecommendationMetadata,
  type ArticleTimeliness,
  type ArticleTopic,
  type PublicArticle,
} from "@/types/publicArticle";

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
  difficultyEvidence: NonNullable<ArticleRecommendationMetadata["difficultyEvidence"]>;
  warning?: string;
}

interface InspectorProps {
  article: PublicArticle;
  articleKind: "candidate" | "published";
  onSave: (summary: string, recommendation: ArticleRecommendationMetadata) => Promise<void>;
}

interface InspectorDraft {
  summary: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  timeliness: ArticleTimeliness;
  reviewNotes: string;
  recommendation: ArticleRecommendationMetadata;
}

const inputClass = "mt-1.5 w-full rounded-lg border border-[#c9ced6] bg-white px-3 py-2 text-sm text-[#17191c] outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15 disabled:bg-[#f0f2f4]";
const labelClass = "block text-xs font-semibold leading-5 text-[#46525c]";

function initialRecommendation(article: PublicArticle): ArticleRecommendationMetadata {
  const existing = article.recommendation ?? article.importedArticle?.recommendation;
  return {
    coverImageUrl: existing?.coverImageUrl ?? "",
    coverImageAlt: existing?.coverImageAlt ?? article.title,
    coverImageSourceUrl: existing?.coverImageSourceUrl ?? article.sourceUrl,
    coverImageCredit: existing?.coverImageCredit ?? "",
    difficulty: existing?.difficulty ?? "高中 / CET-4",
    cefr: existing?.cefr ?? "B2",
    audienceStages: existing?.audienceStages ?? ["高中", "CET-4"],
    topics: existing?.topics ?? ["社会生活"],
    wordCount: countArticleEnglishWords(article.body),
    timeliness: existing?.timeliness ?? "evergreen",
    sourceKind: existing?.sourceKind ?? (article.sourceUrl ? "manual-url" : "manual-paste"),
    classificationSource: existing?.classificationSource ?? "heuristic",
    classifiedAt: existing?.classifiedAt,
    reviewNotes: existing?.reviewNotes ?? "",
    difficultyEvidence: existing?.difficultyEvidence,
    manualFields: existing?.manualFields ?? [],
  };
}

function initialDraft(article: PublicArticle): InspectorDraft {
  const recommendation = initialRecommendation(article);
  return {
    summary: article.summary,
    difficulty: recommendation.difficulty,
    cefr: recommendation.cefr,
    audienceStages: recommendation.audienceStages,
    topics: recommendation.topics,
    timeliness: recommendation.timeliness,
    reviewNotes: recommendation.reviewNotes ?? "",
    recommendation,
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export default function AdminArticleMetadataInspector({ article, articleKind, onSave }: InspectorProps) {
  const [draft, setDraft] = useState(() => initialDraft(article));
  const [baseline, setBaseline] = useState(() => initialDraft(article));
  const [working, setWorking] = useState<"" | "save" | "classify">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const next = initialDraft(article);
    setDraft(next);
    setBaseline(next);
  }, [article]);

  const wordCount = useMemo(() => countArticleEnglishWords(article.body), [article.body]);
  const evidence = draft.recommendation.difficultyEvidence;

  function toggleAudience(stage: ArticleAudienceStage) {
    setDraft((current) => ({
      ...current,
      audienceStages: current.audienceStages.includes(stage)
        ? current.audienceStages.filter((item) => item !== stage)
        : [...current.audienceStages, stage].slice(0, 4),
    }));
  }

  function toggleTopic(topic: ArticleTopic) {
    setDraft((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((item) => item !== topic)
        : [...current.topics, topic].slice(0, 3),
    }));
  }

  async function handleReclassify() {
    setWorking("classify");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/article-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: article.title,
          text: article.body,
          sourceUrl: article.sourceUrl,
          sourceName: article.sourceName,
        }),
      });
      const data = await response.json().catch(() => null) as { classification?: ClassificationResponse; error?: string } | null;
      if (!response.ok || !data?.classification) {
        throw new Error(data?.error || "难度证据分析失败。");
      }
      const classification = data.classification;
      const locked = new Set(draft.recommendation.manualFields ?? []);
      setDraft((current) => ({
        ...current,
        summary: locked.has("summary") ? current.summary : classification.summary,
        difficulty: locked.has("difficulty") ? current.difficulty : classification.difficulty,
        cefr: locked.has("cefr") ? current.cefr : classification.cefr,
        audienceStages: locked.has("audienceStages") ? current.audienceStages : classification.audienceStages,
        topics: locked.has("topics") ? current.topics : classification.topics,
        timeliness: locked.has("timeliness") ? current.timeliness : classification.timeliness,
        reviewNotes: locked.has("reviewNotes") ? current.reviewNotes : classification.reviewNotes,
        recommendation: {
          ...current.recommendation,
          wordCount: classification.wordCount,
          classifiedAt: classification.classifiedAt,
          difficultyEvidence: classification.difficultyEvidence,
          classificationSource: locked.size ? "manual" : classification.classificationSource,
        },
      }));
      setMessage(classification.warning || "证据已更新，人工锁定字段保持不变。点击“保存资料”后写入文章。");
    } catch (classifyError) {
      setError(classifyError instanceof Error ? classifyError.message : "难度证据分析失败。");
    } finally {
      setWorking("");
    }
  }

  async function handleSave() {
    if (!draft.audienceStages.length || !draft.topics.length) {
      setError("适合人群和文章类型至少各选择一项。");
      return;
    }
    setWorking("save");
    setError("");
    setMessage("");
    const changedFields: ArticleManualField[] = [
      ...(draft.summary !== baseline.summary ? ["summary" as const] : []),
      ...(draft.difficulty !== baseline.difficulty ? ["difficulty" as const] : []),
      ...(draft.cefr !== baseline.cefr ? ["cefr" as const] : []),
      ...(!sameArray(draft.audienceStages, baseline.audienceStages) ? ["audienceStages" as const] : []),
      ...(!sameArray(draft.topics, baseline.topics) ? ["topics" as const] : []),
      ...(draft.timeliness !== baseline.timeliness ? ["timeliness" as const] : []),
      ...(draft.reviewNotes !== baseline.reviewNotes ? ["reviewNotes" as const] : []),
    ];
    const manualFields = [...new Set([...(draft.recommendation.manualFields ?? []), ...changedFields])];
    const recommendation: ArticleRecommendationMetadata = {
      ...draft.recommendation,
      difficulty: draft.difficulty,
      cefr: draft.cefr,
      audienceStages: draft.audienceStages,
      topics: draft.topics,
      wordCount,
      timeliness: draft.timeliness,
      reviewNotes: draft.reviewNotes.trim(),
      classificationSource: manualFields.length ? "manual" : draft.recommendation.classificationSource,
      ...(manualFields.length ? { manualFields } : {}),
    };
    try {
      await onSave(draft.summary.trim(), recommendation);
      const next = { ...draft, recommendation };
      setDraft(next);
      setBaseline(next);
      setMessage(manualFields.length
        ? "资料已保存。你改过的字段已锁定，重新分析只会更新证据。"
        : "资料已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "文章资料保存失败。");
    } finally {
      setWorking("");
    }
  }

  return (
    <aside className="sticky top-0 z-20 h-screen w-[350px] shrink-0 overflow-y-auto border-r border-[#d7dde2] bg-[#f7f9fa] px-4 py-4 text-[#17212b]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#1769aa]">{articleKind === "candidate" ? "候选文章" : "已公开推荐"}</p>
          <h1 className="mt-1 line-clamp-3 text-base font-semibold leading-6">{article.title}</h1>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs text-[#4d5963]">{wordCount.toLocaleString("zh-CN")} 词</span>
      </div>

      <div className="mt-5 grid gap-4">
        <label className={labelClass}>难度档位<select className={inputClass} value={draft.difficulty} onChange={(event) => setDraft((current) => ({ ...current, difficulty: event.target.value as ArticleDifficulty }))} disabled={Boolean(working)}>{ARTICLE_DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className={labelClass}>CEFR 辅助等级<select className={inputClass} value={draft.cefr} onChange={(event) => setDraft((current) => ({ ...current, cefr: event.target.value as ArticleCefrLevel }))} disabled={Boolean(working)}>{ARTICLE_CEFR_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>

        <fieldset>
          <legend className={labelClass}>适合人群</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ARTICLE_AUDIENCE_STAGES.map((stage) => <button key={stage} className={`rounded-full px-2.5 py-1.5 text-xs ${draft.audienceStages.includes(stage) ? "bg-[#1769aa] text-white" : "bg-white text-[#46525c]"}`} type="button" aria-pressed={draft.audienceStages.includes(stage)} onClick={() => toggleAudience(stage)} disabled={Boolean(working)}>{stage}</button>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>文章类型与主题</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ARTICLE_TOPICS.map((topic) => <button key={topic} className={`rounded-full px-2.5 py-1.5 text-xs ${draft.topics.includes(topic) ? "bg-[#1769aa] text-white" : "bg-white text-[#46525c]"}`} type="button" aria-pressed={draft.topics.includes(topic)} onClick={() => toggleTopic(topic)} disabled={Boolean(working)}>{topic}</button>)}
          </div>
        </fieldset>

        <label className={labelClass}>时效性<select className={inputClass} value={draft.timeliness} onChange={(event) => setDraft((current) => ({ ...current, timeliness: event.target.value as ArticleTimeliness }))} disabled={Boolean(working)}><option value="evergreen">长期有效</option><option value="time-sensitive">发布前需检查时效</option></select></label>
        <label className={labelClass}>中文摘要<ClearableField value={draft.summary} onClear={() => setDraft((current) => ({ ...current, summary: "" }))} label="清空中文摘要" disabled={Boolean(working)} multiline><textarea className={`${inputClass} min-h-28 resize-y leading-6`} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} maxLength={1000} disabled={Boolean(working)} /></ClearableField></label>
        <label className={labelClass}>发布前备注<ClearableField value={draft.reviewNotes} onClear={() => setDraft((current) => ({ ...current, reviewNotes: "" }))} label="清空发布前备注" disabled={Boolean(working)} multiline><textarea className={`${inputClass} min-h-20 resize-y leading-6`} value={draft.reviewNotes} onChange={(event) => setDraft((current) => ({ ...current, reviewNotes: event.target.value }))} maxLength={500} disabled={Boolean(working)} /></ClearableField></label>
      </div>

      <section className="mt-5 rounded-xl bg-white p-3">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">难度证据</h2><span className="text-xs text-[#68737c]">{evidence ? `置信度 ${evidence.confidence}` : "尚未分析"}</span></div>
        {evidence ? (
          <div className="mt-3 space-y-2 text-xs leading-5 text-[#4d5963]">
            <p>{evidence.sourcePrior}</p>
            <p>平均句长 {evidence.averageSentenceLength} 词，长词 {Math.round(evidence.longWordRatio * 100)}%，复杂句信号 {Math.round(evidence.complexSentenceRatio * 100)}%。</p>
            {evidence.vocabularyProfile && <p>词汇覆盖（模型估计）：A2及以下 {evidence.vocabularyProfile.a2OrBelow}%，B1 {evidence.vocabularyProfile.b1}%，B2 {evidence.vocabularyProfile.b2}%，C1及以上 {evidence.vocabularyProfile.c1OrAbove}%。</p>}
            <p>抽象度 {evidence.abstractness}/5，背景知识 {evidence.backgroundKnowledge}/5。</p>
            {evidence.challengingTerms.length > 0 && <p>代表性难词：{evidence.challengingTerms.join("、")}</p>}
            <p className="text-[#294f6b]">{evidence.rationale}</p>
          </div>
        ) : <p className="mt-2 text-xs leading-5 text-[#68737c]">点击下方按钮，按词汇、句法、抽象度、背景知识与来源受众重新分析。</p>}
        <button className="mt-3 w-full rounded-full border border-[#1769aa] px-3 py-2 text-sm font-medium text-[#1769aa] disabled:opacity-45" type="button" onClick={() => void handleReclassify()} disabled={Boolean(working)}>{working === "classify" ? "正在分析证据..." : "重新分析证据"}</button>
      </section>

      {(message || error) && <p className={`mt-4 rounded-lg px-3 py-2 text-xs leading-5 ${error ? "bg-red-50 text-red-700" : "bg-[#e9f5ee] text-[#17613b]"}`}>{error || message}</p>}
      <button className="mt-4 w-full rounded-full bg-[#1769aa] px-4 py-2.5 text-sm font-semibold text-white disabled:bg-[#aeb8c2]" type="button" onClick={() => void handleSave()} disabled={Boolean(working)}>{working === "save" ? "正在保存..." : "保存资料"}</button>
    </aside>
  );
}
