import type { PublicArticle } from "@/types/publicArticle";
import { HOME_CURATION_CATEGORIES, type HomepageCuration } from "@/lib/homepageCurationShared";
import { articleMatchesEditorialCategory } from "@/lib/editorialCuration";
import { homepageShowcaseArticles, orderHomepageCategoryArticles, orderHomepageRecommendations, HOMEPAGE_RECOMMENDATION_TARGET } from "@/lib/homepageRecommendations";
import { emptyRecommendationPreferences } from "@/lib/recommendationPreferencesShared";

/** Preserve each category's exact SSR showcase; the complete catalogue is fetched before browsing it. */
export function homepageBootstrap(articles: PublicArticle[], curation: HomepageCuration | undefined, day: string) {
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  for (const category of HOME_CURATION_CATEGORIES) {
    const ordered = category === "推荐"
      ? orderHomepageRecommendations(articles, curation, emptyRecommendationPreferences(), day)
      : orderHomepageCategoryArticles(articles.filter(article => articleMatchesEditorialCategory(article, category)), curation?.categories[category] ?? [], curation?.selectedAtById, day);
    counts[category] = ordered.length;
    for (const article of homepageShowcaseArticles(ordered, HOMEPAGE_RECOMMENDATION_TARGET)) ids.add(article.id);
  }
  return { articles: articles.filter(article => ids.has(article.id)), counts, complete: ids.size === articles.length };
}

/** Ship only ordering metadata for the SSR subset; full browsing loads its own metadata. */
export function homepageBootstrapCuration(curation: HomepageCuration | undefined, articles: PublicArticle[]): HomepageCuration | undefined {
  if (!curation) return undefined;
  const ids = new Set(articles.map(article => article.id));
  return {
    ...curation,
    categories: Object.fromEntries(HOME_CURATION_CATEGORIES.map(category => [category, curation.categories[category].filter(id => ids.has(id))])) as HomepageCuration["categories"],
    selectedAtById: Object.fromEntries(Object.entries(curation.selectedAtById).filter(([id]) => ids.has(id))),
  };
}
