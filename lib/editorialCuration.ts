import type { ArticleRecommendationMetadata, PublicArticle } from "@/types/publicArticle";
import type { HomeCurationCategory, HomepageCuration } from "@/lib/homepageCurationShared";

export type EditorialCategory = Exclude<HomeCurationCategory, "推荐">;

export const EDITORIAL_CATEGORIES: EditorialCategory[] = ["时事", "科技", "文化", "商业"];

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
  featured: boolean,
): HomepageCuration {
  const categories = { ...curation.categories };
  categories.推荐 = [articleId, ...withoutId(categories.推荐, articleId)];
  const categoryIds = withoutId(categories[category], articleId);
  categories[category] = featured
    ? [articleId, ...categoryIds]
    : categoryIds.length
      ? [categoryIds[0], articleId, ...categoryIds.slice(1)]
      : [articleId];
  return { ...curation, categories };
}
