import { DAILY_CATEGORIES, DAILY_CATEGORY_MIN } from "./editorialDistribution";

type Category = (typeof DAILY_CATEGORIES)[number];
type Site = { id: string; topics: string[]; feeds?: string[]; feedPagination?: "none"; pendingCount?: number; levelHint?: string; enabled: boolean; verification?: { ok: boolean } };
type Visit = { visits: number; empty?: number };
export type SourceCategoryYield = { total: number; categories: Partial<Record<Category, number>> };

export function sourceCategory(topic: string): Category {
  if (topic === "商业经济") return "商业";
  if (topic === "社会生活") return "时事";
  if (topic === "科技科学" || topic === "自然环境") return "科技";
  return "文化";
}

/** Fill unmet category minimums before spending attempts on optional surplus. */
export function rankEditorialSources<T extends Site>(
  sites: T[], counts: Record<string, number>, visits: Record<string, Visit>,
  observed: Record<string, SourceCategoryYield> = {},
): T[] {
  const available = sites.filter(s => s.enabled && s.verification?.ok && s.levelHint !== "lower"
    && ((s.pendingCount || 0) > 0 || (visits[s.id]?.visits || 0) < 6 && ((visits[s.id]?.empty || 0) < 2
      || (s.feedPagination !== "none" && s.feeds?.some(url => /\/feed(?:\/rss)?\/?$/.test(new URL(url).pathname))))));
  const deficits = DAILY_CATEGORIES.filter(category => (counts[category] || 0) < DAILY_CATEGORY_MIN);
  // Hints and past output affect priority, never eliminate a source's other good articles.
  return available.sort((a, b) => {
    const score = (s: T) => {
      const need = Math.max(0,...s.topics.map(topic=>DAILY_CATEGORY_MIN-(counts[sourceCategory(topic)] || 0)));
      const seen = observed[s.id];
      const relevant: readonly Category[] = deficits.length ? deficits : DAILY_CATEGORIES;
      const observedYield = seen && seen.total >= 3
        ? 120 * relevant.reduce<number>((n, category) => n + (seen.categories[category] || 0), 0) / seen.total
        : 0;
      const primaryNeed = Math.max(0, DAILY_CATEGORY_MIN - (counts[sourceCategory(s.topics[0])] || 0));
      return ((visits[s.id]?.visits || 0) === 0 ? 1000 : 0) + need * 40 + primaryNeed + observedYield - (visits[s.id]?.visits || 0) * 9;
    };
    return score(b) - score(a);
  });
}
