import type { ArticleRecommendationMetadata, PublicArticle } from "@/types/publicArticle";
import type { HomeCurationCategory, HomepageCuration } from "@/lib/homepageCurationShared";

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
  };
}

export function removePublishedArticle(
  curation: HomepageCuration,
  articleId: string,
): HomepageCuration {
  return {
    ...curation,
    recommendationFeaturedId: curation.recommendationFeaturedId === articleId ? "" : curation.recommendationFeaturedId,
    categories: Object.fromEntries(
      Object.entries(curation.categories).map(([category, ids]) => [category, withoutId(ids, articleId)]),
    ) as HomepageCuration["categories"],
  };
}
