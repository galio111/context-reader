import {
  articleMatchesRecommendationInterest,
  audienceStagesForReadingLevel,
  type RecommendationPreferences,
} from "@/lib/recommendationPreferences";
import type { HomepageCuration } from "@/lib/homepageCurationShared";
import type { PublicArticle } from "@/types/publicArticle";

export const HOMEPAGE_RECOMMENDATION_TARGET = 10;

function stableRecommendationRank(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hasCover(article: PublicArticle): boolean {
  return Boolean(article.recommendation?.coverImageUrl?.trim());
}

function preferenceScore(article: PublicArticle, preferences: RecommendationPreferences): number {
  const preferredStages = audienceStagesForReadingLevel(preferences.readingLevel);
  const levelScore = preferredStages.some((stage) => article.recommendation?.audienceStages.includes(stage)) ? 4 : 0;
  const interestScore = preferences.interests.filter((interest) => articleMatchesRecommendationInterest(article, interest)).length * 2;
  return levelScore + interestScore;
}

function uniqueArticles(items: Array<PublicArticle | undefined>): PublicArticle[] {
  return [...new Map(
    items.filter((article): article is PublicArticle => Boolean(article)).map((article) => [article.id, article]),
  ).values()];
}

function fallbackOrder(
  articles: PublicArticle[],
  preferences: RecommendationPreferences,
  dayKey: string,
): PublicArticle[] {
  const hasPreferences = Boolean(preferences.readingLevel || preferences.interests.length);
  return [...articles].sort((left, right) => {
    if (hasPreferences) {
      const scoreDifference = preferenceScore(right, preferences) - preferenceScore(left, preferences);
      if (scoreDifference) return scoreDifference;
    }
    const coverDifference = Number(hasCover(right)) - Number(hasCover(left));
    if (coverDifference) return coverDifference;
    return stableRecommendationRank(`${dayKey}:${left.id}`) - stableRecommendationRank(`${dayKey}:${right.id}`);
  });
}

/**
 * The Admin-selected recommendation pool is authoritative. When it cannot fill
 * one featured article plus three complete rows, the remaining published
 * inventory supplies a daily-stable, preference-ranked fallback. This keeps a
 * sparse editorial pool from turning into an empty or single-card homepage.
 */
export function orderHomepageRecommendations(
  articles: PublicArticle[],
  curation: HomepageCuration | undefined,
  preferences: RecommendationPreferences,
  dayKey: string,
): PublicArticle[] {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const manual = uniqueArticles((curation?.categories.推荐 ?? []).map((id) => byId.get(id)));
  const explicitFeatured = curation?.recommendationFeaturedId
    ? byId.get(curation.recommendationFeaturedId)
    : undefined;
  const hasPreferences = Boolean(preferences.readingLevel || preferences.interests.length);
  const manualOrdered = hasPreferences
    ? [...manual].sort((left, right) => (
        preferenceScore(right, preferences) - preferenceScore(left, preferences)
        || Number(hasCover(right)) - Number(hasCover(left))
        || stableRecommendationRank(`${dayKey}:manual:${left.id}`) - stableRecommendationRank(`${dayKey}:manual:${right.id}`)
      ))
    : manual;

  const featured = hasPreferences
    ? manualOrdered.find((article) => preferenceScore(article, preferences) > 0)
      ?? fallbackOrder(articles, preferences, `${dayKey}:featured`)[0]
    : explicitFeatured ?? manualOrdered[0];
  const manualRest = manualOrdered.filter((article) => article.id !== featured?.id);
  const claimedIds = new Set([featured?.id, ...manualRest.map((article) => article.id)].filter(Boolean));
  const fallback = fallbackOrder(articles.filter((article) => !claimedIds.has(article.id)), preferences, dayKey);
  const manualIds = new Set(manual.map((article) => article.id));
  const rest = hasPreferences
    ? [...manualRest, ...fallback].sort((left, right) => (
        preferenceScore(right, preferences) - preferenceScore(left, preferences)
        || Number(manualIds.has(right.id)) - Number(manualIds.has(left.id))
        || Number(hasCover(right)) - Number(hasCover(left))
        || stableRecommendationRank(`${dayKey}:personalized:${left.id}`) - stableRecommendationRank(`${dayKey}:personalized:${right.id}`)
      ))
    : [...manualRest, ...fallback];
  const ordered = uniqueArticles([featured, ...rest]);
  return ordered;
}
