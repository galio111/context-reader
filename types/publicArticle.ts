import type { ImportedArticle } from "@/types/article";
import type { ArticleTranslationItem, WordExplanation } from "@/types/reader";

export const ARTICLE_DIFFICULTIES = [
  "小学高年级",
  "初中",
  "高中 / CET-4",
  "CET-6 / 考研",
  "雅思 / 托福基础",
  "雅思 / 托福进阶",
] as const;

export const ARTICLE_CEFR_LEVELS = ["A2", "B1", "B2", "C1", "C2"] as const;

export const ARTICLE_AUDIENCE_STAGES = [
  "小学",
  "初中",
  "高中",
  "CET-4",
  "CET-6",
  "考研",
  "IELTS",
  "TOEFL",
] as const;

export const ARTICLE_TOPICS = ["科技科学", "自然环境", "文化历史", "社会生活", "商业经济", "人物成长", "故事文学"] as const;

export type ArticleDifficulty = (typeof ARTICLE_DIFFICULTIES)[number];
export type ArticleCefrLevel = (typeof ARTICLE_CEFR_LEVELS)[number];
export type ArticleAudienceStage = (typeof ARTICLE_AUDIENCE_STAGES)[number];
export type ArticleTopic = (typeof ARTICLE_TOPICS)[number];
export type ArticleTimeliness = "evergreen" | "time-sensitive";
export type ArticleSourceKind = "manual-paste" | "manual-url" | "local-saved" | "crawler";
export type ArticleSourceProfile = "general" | "youth" | "learner" | "exam" | "unknown";
export type ArticleClassificationConfidence = "low" | "medium" | "high";
export type ArticleManualField =
  | "summary"
  | "difficulty"
  | "cefr"
  | "audienceStages"
  | "topics"
  | "homepageCategory"
  | "timeliness"
  | "reviewNotes";

export interface ArticleVocabularyProfile {
  a2OrBelow: number;
  b1: number;
  b2: number;
  c1OrAbove: number;
}

export interface ArticleDifficultyEvidence {
  wordCount: number;
  sentenceCount: number;
  averageSentenceLength: number;
  longWordRatio: number;
  lexicalDiversity: number;
  complexSentenceRatio: number;
  sourceProfile: ArticleSourceProfile;
  sourcePrior: string;
  vocabularyProfile?: ArticleVocabularyProfile;
  abstractness: number;
  backgroundKnowledge: number;
  challengingTerms: string[];
  confidence: ArticleClassificationConfidence;
  rationale: string;
}

export interface ArticleRecommendationMetadata {
  discoverySourceId?: string;
  rejectionReason?: string;
  coverImageUrl: string;
  coverImageAlt?: string;
  coverImageSourceUrl?: string;
  coverImageCredit?: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  homepageCategory?: "时事" | "科技" | "文化" | "商业";
  wordCount: number;
  /** Kept only so older recommendation JSON can be read during migration. */
  readingMinutes?: number;
  timeliness: ArticleTimeliness;
  sourceKind: ArticleSourceKind;
  classificationSource: "model" | "heuristic" | "manual";
  classifiedAt?: string;
  reviewNotes?: string;
  difficultyEvidence?: ArticleDifficultyEvidence;
  manualFields?: ArticleManualField[];
  rejectedAt?: string;
}

export interface PublicExplanation {
  id?: string;
  cacheKey: string;
  word: string;
  sentence: string;
  explanation: WordExplanation;
}

export interface PublicArticleTranslation {
  id?: string;
  cacheKey: string;
  translations: ArticleTranslationItem[];
}

export interface PublicArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  sourceUrl: string;
  sourceName: string;
  importedArticle?: ImportedArticle;
  recommendation?: ArticleRecommendationMetadata;
  explanations?: PublicExplanation[];
  articleTranslations?: PublicArticleTranslation[];
  published?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicArticleInput {
  title: string;
  summary: string;
  body: string;
  sourceUrl?: string;
  sourceName?: string;
  importedArticle?: ImportedArticle | null;
  recommendation?: ArticleRecommendationMetadata;
  explanations?: PublicExplanation[];
  articleTranslations?: PublicArticleTranslation[];
}

export interface PublicArticleCandidateInput extends PublicArticleInput {
  id?: string;
}
