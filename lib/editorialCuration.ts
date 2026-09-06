import type { ArticleRecommendationMetadata, PublicArticle } from "@/types/publicArticle";
import type { HomeCurationCategory, HomepageCuration } from "@/lib/homepageCurationShared";
import { shanghaiDay } from "@/lib/discoveryPolicy";

export type EditorialCategory = Exclude<HomeCurationCategory, "推荐">;

export const EDITORIAL_CATEGORIES: EditorialCategory[] = ["时事", "科技", "文化", "商业"];

export interface PublishedArticlePlacement {
  categoryFeatured: boolean;
  includeInRecommendation: boolean;
  recommendationFeatured: boolean;
  preferLater?: boolean;
}

export function editorialCategoryForRecommendation(
  recommendation: ArticleRecommendationMetadata | undefined,
): EditorialCategory {
  if (recommendation?.homepageCategory && EDITORIAL_CATEGORIES.includes(recommendation.homepageCategory)) {
    return recommendation.homepageCategory;
  }
  const topics = recommendation?.topics ?? [];
  if (topics.includes("商业经济")) return "商业";
  if (topics.includes("社会生活")) return "时事";
  if (topics.some((topic) => topic === "科技科学" || topic === "自然环境")) return "科技";
  return "文化";
}

export function editorialCategoryForArticle(article: PublicArticle): EditorialCategory {
  return editorialCategoryForRecommendation(article.recommendation ?? article.importedArticle?.recommendation);
}

export function articleMatchesEditorialCategory(article: PublicArticle, category: EditorialCategory): boolean {
  const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
  if (recommendation?.homepageCategory) return recommendation.homepageCategory === category;
  return editorialCategoryForRecommendation(recommendation) === category;
}

export function markPublishedArticleSelected(
  curation: HomepageCuration,
  articleId: string,
  selectedAt = new Date().toISOString(),
): HomepageCuration {
  return {
    ...curation,
    selectedAtById: { ...curation.selectedAtById, [articleId]: selectedAt },
  };
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function shuffleCategoryIds(
  ids: string[],
  todayIds: Set<string>,
  currentFeaturedId: string,
  random: () => number,
): { ids: string[]; featuredId: string } {
  if (!ids.length) return { ids: [], featuredId: "" };
  const today = ids.filter((id) => todayIds.has(id));
  const older = ids.filter((id) => !todayIds.has(id));
  const preserveFeatured = todayIds.has(currentFeaturedId) && ids.includes(currentFeaturedId);
  const selectedFeatured = preserveFeatured
    ? currentFeaturedId
    : shuffled(today.length ? today : ids, random)[0] ?? "";
  const orderedToday = shuffled(today.filter((id) => id !== selectedFeatured), random);
  const orderedOlder = shuffled(older.filter((id) => id !== selectedFeatured), random);
  return {
    ids: [selectedFeatured, ...orderedToday, ...orderedOlder].filter(Boolean),
    featuredId: selectedFeatured,
  };
}

/**
 * Shuffle the published homepage, never the review queue. Articles selected
 * today stay before older work; a featured item explicitly selected today is
 * preserved. Otherwise the featured slot is drawn from today's selection, or
 * from the whole category when that category has no selection today.
 */
export function shufflePublishedHomepageCuration(
  curation: HomepageCuration,
  articles: PublicArticle[],
  now: string | number | Date = Date.now(),
  random: () => number = Math.random,
): HomepageCuration {
  const today = shanghaiDay(now);
  const articleById = new Map(articles.map((article) => [article.id, article]));
  const selectedAtById = { ...curation.selectedAtById };
  for (const article of articles) {
    selectedAtById[article.id] ||= article.updatedAt || article.createdAt;
  }
  const selectedToday = new Set(articles
    .filter((article) => shanghaiDay(selectedAtById[article.id]) === today)
    .map((article) => article.id));
  const categories = { ...curation.categories };

  for (const category of EDITORIAL_CATEGORIES) {
    const currentIds = curation.categories[category].filter((id) => articleById.has(id));
    const pool = [...new Set([
      ...currentIds,
      ...articles.filter((article) => articleMatchesEditorialCategory(article, category)).map((article) => article.id),
    ])];
    categories[category] = shuffleCategoryIds(pool, selectedToday, currentIds[0] ?? "", random).ids;
  }

  const recommendationPool = curation.categories.推荐.filter((id) => articleById.has(id));
  const recommendation = shuffleCategoryIds(
    recommendationPool,
    selectedToday,
    curation.recommendationFeaturedId,
    random,
  );
  categories.推荐 = recommendation.ids;

  return {
    ...curation,
    categories,
    recommendationFeaturedId: recommendation.featuredId,
    selectedAtById,
  };
}

function withoutId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id);
}

export function placePublishedArticle(
  curation: HomepageCuration,
  articleId: string,
  category: EditorialCategory,
  options: PublishedArticlePlacement,
): HomepageCuration {
  return setPublishedArticlePlacement(curation, articleId, category, options);
}

export function setPublishedArticlePlacement(
  curation: HomepageCuration,
  articleId: string,
  category: EditorialCategory,
  options: PublishedArticlePlacement,
): HomepageCuration {
  const categories = Object.fromEntries(
    Object.entries(curation.categories).map(([label, ids]) => [label, withoutId(ids, articleId)]),
  ) as HomepageCuration["categories"];
  const nextRecommendationFeaturedId = options.recommendationFeatured
    ? articleId
    : curation.recommendationFeaturedId === articleId ? "" : curation.recommendationFeaturedId;

  if (options.includeInRecommendation || options.recommendationFeatured) {
    const recommendationIds = withoutId(categories.推荐, nextRecommendationFeaturedId);
    if (options.recommendationFeatured) {
      categories.推荐 = [articleId, ...withoutId(recommendationIds, articleId)];
    } else if (options.preferLater) {
      categories.推荐 = nextRecommendationFeaturedId
        ? [nextRecommendationFeaturedId, ...recommendationIds, articleId]
        : [...recommendationIds, articleId];
    } else {
      categories.推荐 = nextRecommendationFeaturedId
        ? [nextRecommendationFeaturedId, articleId, ...recommendationIds]
        : [articleId, ...recommendationIds];
    }
  }

  if (options.categoryFeatured) {
    categories[category] = [articleId, ...categories[category]];
  }
  return {
    ...curation,
    categories,
    recommendationFeaturedId: nextRecommendationFeaturedId,
    selectedAtById: curation.selectedAtById,
  };
}

export function removePublishedArticle(
  curation: HomepageCuration,
  articleId: string,
): HomepageCuration {
  return {
    ...curation,
    recommendationFeaturedId: curation.recommendationFeaturedId === articleId ? "" : curation.recommendationFeaturedId,
    selectedAtById: Object.fromEntries(Object.entries(curation.selectedAtById).filter(([id]) => id !== articleId)),
    categories: Object.fromEntries(
      Object.entries(curation.categories).map(([category, ids]) => [category, withoutId(ids, articleId)]),
    ) as HomepageCuration["categories"],
  };
}
