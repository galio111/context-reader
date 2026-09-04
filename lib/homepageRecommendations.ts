import {
  articleMatchesRecommendationInterest,
  audienceStagesForReadingLevel,
  type RecommendationPreferences,
} from "@/lib/recommendationPreferences";
import type { HomepageCuration } from "@/lib/homepageCurationShared";
import type { PublicArticle } from "@/types/publicArticle";

export const HOMEPAGE_RECOMMENDATION_TARGET = 10;
export const HOMEPAGE_MOBILE_RECOMMENDATION_TARGET = 7;

/**
 * Keep the accepted showcase stagger, but never let the expanded library's
 * absolute article position add an ever-growing pause before its reveal.
 */
export function recommendationRevealDelayIndex(index: number, showcaseCount: number): number {
  const safeIndex = Math.max(0, Math.floor(index));
  const lastShowcaseIndex = Math.max(0, Math.floor(showcaseCount) - 1);
  return Math.min(safeIndex, lastShowcaseIndex);
}

function stableRecommendationRank(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hasHomepageCover(article: PublicArticle): boolean {
  return Boolean(article.recommendation?.coverImageUrl?.trim());
}

/**
 * Preserve an explicit first article, keep the next three desktop rows image-safe,
 * then weave text-only entries through the remaining library instead of dumping
 * them into one solid block at the very end.
 */
export function deferHomepageImageFreeArticles(
  articles: PublicArticle[],
  preserveFeatured = true,
): PublicArticle[] {
  if (articles.length <= 1) return articles;
  const featured = preserveFeatured ? articles[0] : undefined;
  const remaining = preserveFeatured ? articles.slice(1) : [...articles];
  const withCover = remaining.filter(hasHomepageCover);
  const withoutCover = remaining.filter((article) => !hasHomepageCover(article));
  const protectedRows = withCover.splice(0, HOMEPAGE_RECOMMENDATION_TARGET - (featured ? 1 : 0));
  const tail: PublicArticle[] = [];
  while (withCover.length || withoutCover.length) {
    tail.push(...withCover.splice(0, 2));
    const textOnly = withoutCover.shift();
    if (textOnly) tail.push(textOnly);
  }
  return uniqueArticles([featured, ...protectedRows, ...tail]);
}

/** The collapsed surface never fills one of the three rows with a text-only card. */
export function homepageShowcaseArticles(articles: PublicArticle[], count: number): PublicArticle[] {
  if (!articles.length || count <= 0) return [];
  return [articles[0], ...articles.slice(1).filter(hasHomepageCover)].slice(0, count);
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

/** Editorial placement controls order without hiding the rest of a category. */
export function orderHomepageCategoryArticles(
  articles: PublicArticle[],
  curatedIds: string[],
): PublicArticle[] {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const curatedIdSet = new Set(curatedIds);
  return deferHomepageImageFreeArticles(uniqueArticles([
    ...curatedIds.map((id) => byId.get(id)),
    ...articles.filter((article) => !curatedIdSet.has(article.id)),
  ]), curatedIds.length > 0);
}

/**
 * The Admin-selected recommendation pool is authoritative. Published articles
 * that are not in it must never silently reappear as fallback recommendations.
 */
export function orderHomepageRecommendations(
  articles: PublicArticle[],
  curation: HomepageCuration | undefined,
  preferences: RecommendationPreferences,
  dayKey: string,
): PublicArticle[] {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const manual = curation
    ? uniqueArticles(curation.categories.推荐.map((id) => byId.get(id)))
    : articles;
  const explicitFeatured = curation?.recommendationFeaturedId
    ? byId.get(curation.recommendationFeaturedId)
    : undefined;
  const hasPreferences = Boolean(preferences.readingLevel || preferences.interests.length);
  const manualOrdered = hasPreferences
    ? [...manual].sort((left, right) => (
        preferenceScore(right, preferences) - preferenceScore(left, preferences)
        || Number(hasHomepageCover(right)) - Number(hasHomepageCover(left))
        || stableRecommendationRank(`${dayKey}:manual:${left.id}`) - stableRecommendationRank(`${dayKey}:manual:${right.id}`)
      ))
    : manual;

  const featured = hasPreferences
    ? manualOrdered.find((article) => preferenceScore(article, preferences) > 0)
      ?? (explicitFeatured && manual.some((article) => article.id === explicitFeatured.id) ? explicitFeatured : undefined)
      ?? manualOrdered[0]
    : explicitFeatured && manual.some((article) => article.id === explicitFeatured.id)
      ? explicitFeatured
      : manualOrdered[0];
  const manualRest = manualOrdered.filter((article) => article.id !== featured?.id);
  const manualIds = new Set(manual.map((article) => article.id));
  const rest = hasPreferences
    ? [...manualRest].sort((left, right) => (
        preferenceScore(right, preferences) - preferenceScore(left, preferences)
        || Number(manualIds.has(right.id)) - Number(manualIds.has(left.id))
        || Number(hasHomepageCover(right)) - Number(hasHomepageCover(left))
        || stableRecommendationRank(`${dayKey}:personalized:${left.id}`) - stableRecommendationRank(`${dayKey}:personalized:${right.id}`)
      ))
    : manualRest;
  const ordered = uniqueArticles([featured, ...rest]);
  return deferHomepageImageFreeArticles(ordered);
}
