export const HOME_CURATION_CATEGORIES = ["推荐", "时事", "科技", "文化", "商业"] as const;
export type HomeCurationCategory = (typeof HOME_CURATION_CATEGORIES)[number];

export interface HomepageCuration {
  version: 2;
  categories: Record<HomeCurationCategory, string[]>;
  recommendationFeaturedId: string;
  updatedAt: string;
}

function emptyCategories(): HomepageCuration["categories"] {
  return { 推荐: [], 时事: [], 科技: [], 文化: [], 商业: [] };
}

export function normalizeHomepageCuration(value: unknown): HomepageCuration {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawCategories = input.categories && typeof input.categories === "object" && !Array.isArray(input.categories)
    ? input.categories as Record<string, unknown>
    : {};
  const categories = emptyCategories();
  for (const category of HOME_CURATION_CATEGORIES) {
    const ids = Array.isArray(rawCategories[category]) ? rawCategories[category] as unknown[] : [];
    categories[category] = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length <= 100))].slice(0, 60);
  }
  const explicitRecommendationFeaturedId = typeof input.recommendationFeaturedId === "string"
    && input.recommendationFeaturedId.length <= 100
    ? input.recommendationFeaturedId
    : "";
  const recommendationFeaturedId = explicitRecommendationFeaturedId
    || (input.version === 1 ? categories.推荐[0] ?? "" : "");
  return {
    version: 2,
    categories,
    recommendationFeaturedId,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
  };
}
