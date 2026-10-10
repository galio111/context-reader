export const HOME_CURATION_CATEGORIES = ["推荐", "时事", "科技", "文化", "商业"] as const;
export type HomeCurationCategory = (typeof HOME_CURATION_CATEGORIES)[number];

export interface HomepageCuration {
  version: 2;
  categories: Record<HomeCurationCategory, string[]>;
  recommendationFeaturedId: string;
  selectedAtById: Record<string, string>;
  updatedAt: string;
  editorialShuffle?: { day: string; publicationSignature: string; completedAt: string };
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
    // Topic tabs contain the full published library, already larger than 500.
    // The recommendation whitelist keeps its existing bounded selection policy.
    categories[category] = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length <= 100))].slice(0, category === "推荐" ? 500 : 10_000);
  }
  const rawSelectedAtById = input.selectedAtById && typeof input.selectedAtById === "object" && !Array.isArray(input.selectedAtById)
    ? input.selectedAtById as Record<string, unknown>
    : {};
  const active = new Set(Object.values(categories).flat());
  const selectedAtById = Object.fromEntries(Object.entries(rawSelectedAtById)
    .filter(([id, selectedAt]) => id.length <= 100 && typeof selectedAt === "string" && Number.isFinite(Date.parse(selectedAt)))
    .sort(([a, at], [b, bt]) => {
      return Number(active.has(b)) - Number(active.has(a))
        || Date.parse(bt as string) - Date.parse(at as string) || a.localeCompare(b);
    })
    .slice(0, 10_000)) as Record<string, string>;
  const explicitRecommendationFeaturedId = typeof input.recommendationFeaturedId === "string"
    && input.recommendationFeaturedId.length <= 100
    ? input.recommendationFeaturedId
    : "";
  const recommendationFeaturedId = explicitRecommendationFeaturedId
    || (input.version === 1 ? categories.推荐[0] ?? "" : "");
  const shuffle = input.editorialShuffle as HomepageCuration["editorialShuffle"] | undefined;
  const editorialShuffle = shuffle && /^\d{4}-\d{2}-\d{2}$/.test(shuffle.day)
    && /^[a-f0-9]{64}$/.test(shuffle.publicationSignature)
    && Number.isFinite(Date.parse(shuffle.completedAt))
    ? { day: shuffle.day, publicationSignature: shuffle.publicationSignature, completedAt: shuffle.completedAt }
    : undefined;
  return {
    version: 2,
    categories,
    recommendationFeaturedId,
    selectedAtById,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
    ...(editorialShuffle ? { editorialShuffle } : {}),
  };
}
