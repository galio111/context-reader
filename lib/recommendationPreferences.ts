"use client";

import { notifyAccountDataChanged } from "@/lib/accountEvents";
import { type ArticleAudienceStage, type PublicArticle } from "@/types/publicArticle";

export const RECOMMENDATION_PREFERENCES_STORAGE_KEY = "context-reader:recommendation-preferences:v1";
export const RECOMMENDATION_PREFERENCES_OBJECT_KEY = "homepage-recommendation-preferences";
export const RECOMMENDATION_PREFERENCES_CHANGED_EVENT = "context-reader:recommendation-preferences-changed";

export const RECOMMENDATION_READING_LEVELS = ["高中", "四级", "六级", "考研", "雅思/托福"] as const;
export type RecommendationReadingLevel = (typeof RECOMMENDATION_READING_LEVELS)[number];

export const RECOMMENDATION_INTERESTS = [
  { id: "science", label: "科技与科学" },
  { id: "nature", label: "自然与环境" },
  { id: "culture", label: "文化与历史" },
  { id: "current", label: "社会与时事" },
  { id: "business", label: "商业与经济" },
  { id: "growth", label: "人物与成长" },
  { id: "literature", label: "故事与文学" },
  { id: "health", label: "健康与生活" },
] as const;
export type RecommendationInterest = (typeof RECOMMENDATION_INTERESTS)[number]["id"];

export interface RecommendationPreferences {
  version: 1;
  readingLevel: RecommendationReadingLevel | "";
  interests: RecommendationInterest[];
  updatedAt: string;
  scope: "guest" | "account";
}

export function emptyRecommendationPreferences(): RecommendationPreferences {
  return { version: 1, readingLevel: "", interests: [], updatedAt: "", scope: "guest" };
}

export function normalizeRecommendationPreferences(value: unknown): RecommendationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyRecommendationPreferences();
  const input = value as Record<string, unknown>;
  const readingLevel = typeof input.readingLevel === "string"
    && RECOMMENDATION_READING_LEVELS.includes(input.readingLevel as RecommendationReadingLevel)
    ? input.readingLevel as RecommendationReadingLevel
    : "";
  const allowedInterests = RECOMMENDATION_INTERESTS.map((item) => item.id);
  const interests = Array.isArray(input.interests)
    ? [...new Set(input.interests.filter(
      (item): item is RecommendationInterest => typeof item === "string" && allowedInterests.includes(item as RecommendationInterest),
    ))]
    : [];
  return {
    version: 1,
    readingLevel,
    interests,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
    scope: input.scope === "account" ? "account" : "guest",
  };
}

export function readRecommendationPreferences(storage?: Storage): RecommendationPreferences {
  if (!storage && typeof window === "undefined") return emptyRecommendationPreferences();
  const source = storage ?? window.localStorage;
  try {
    return normalizeRecommendationPreferences(JSON.parse(source.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY) || "null"));
  } catch {
    return emptyRecommendationPreferences();
  }
}

export function writeRecommendationPreferences(
  input: Pick<RecommendationPreferences, "readingLevel" | "interests">,
  options: { authenticated: boolean },
): RecommendationPreferences {
  const next = normalizeRecommendationPreferences({
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
    scope: options.authenticated ? "account" : "guest",
  });
  window.localStorage.setItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(RECOMMENDATION_PREFERENCES_CHANGED_EVENT, { detail: next }));
  if (options.authenticated) notifyAccountDataChanged(["preferences"]);
  return next;
}

export function writeRecommendationPreferencesFromSync(storage: Storage, input: unknown): RecommendationPreferences {
  const next = normalizeRecommendationPreferences({ ...(input as Record<string, unknown>), scope: "account" });
  storage.setItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function audienceStagesForReadingLevel(level: RecommendationReadingLevel | ""): ArticleAudienceStage[] {
  if (level === "高中") return ["高中"];
  if (level === "四级") return ["CET-4"];
  if (level === "六级") return ["CET-6"];
  if (level === "考研") return ["考研"];
  if (level === "雅思/托福") return ["IELTS", "TOEFL"];
  return [];
}

export function articleMatchesRecommendationInterest(article: PublicArticle, interest: RecommendationInterest): boolean {
  const metadata = article.recommendation;
  const text = `${article.title} ${article.summary} ${article.sourceName}`;
  if (interest === "science") return metadata?.topics.includes("科技科学") ?? false;
  if (interest === "nature") return metadata?.topics.includes("自然环境") ?? false;
  if (interest === "culture") return metadata?.topics.includes("文化历史") ?? false;
  if (interest === "current") return metadata?.topics.includes("社会生活") ?? false;
  if (interest === "growth") return metadata?.topics.includes("人物成长") ?? false;
  if (interest === "literature") return metadata?.topics.includes("故事文学") ?? false;
  if (interest === "business") return /business|econom|finance|market|trade|industry|商业|经济|金融/i.test(text);
  return /health|medicine|medical|wellbeing|wellness|sleep|exercise|nutrition|diet|健康|医疗|生活方式/i.test(text);
}
