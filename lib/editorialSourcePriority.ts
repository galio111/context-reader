import { DAILY_CATEGORIES, categoryHasCapacity, DAILY_CATEGORY_MIN } from "./editorialDistribution";

type Category = (typeof DAILY_CATEGORIES)[number];
type Site = { id: string; topics: string[]; feeds?: string[]; levelHint?: string; enabled: boolean; verification?: { ok: boolean } };
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
    && (visits[s.id]?.visits || 0) < 6 && ((visits[s.id]?.empty || 0) < 2
      || s.feeds?.some(url => /\/feed(?:\/rss)?\/?$/.test(new URL(url).pathname))));
  const deficits = DAILY_CATEGORIES.filter(category => (counts[category] || 0) < DAILY_CATEGORY_MIN);
  const canFill = (site: T) => {
    const yieldRecord = observed[site.id];
    const proven=yieldRecord && yieldRecord.total>=3 && deficits.some(category=>(yieldRecord.categories[category] || 0)>0);
    if (!proven && !site.topics.some(topic => deficits.includes(sourceCategory(topic)))) return false;
    // A source's declared topics are only hints. Stop retrying it for a missing
    // category after repeated real classifications produce none of that category.
    return !yieldRecord || yieldRecord.total < 8 || deficits.some(category => (yieldRecord.categories[category] || 0) > 0);
  };
  let pool: T[];
  if (deficits.length) {
    const primary = available.filter(s => canFill(s) && deficits.includes(sourceCategory(s.topics[0])));
    const provenSecondary=available.filter(s => canFill(s) && (observed[s.id]?.total || 0)>=3
      && deficits.some(category=>(observed[s.id].categories[category] || 0)>0));
    pool = primary.length ? [...new Map([...primary,...provenSecondary].map(s=>[s.id,s])).values()] : available.filter(canFill);
  } else {
    pool = available.filter(s => categoryHasCapacity(sourceCategory(s.topics[0]), counts[sourceCategory(s.topics[0])] || 0));
  }
  return pool.sort((a, b) => {
    const score = (s: T) => {
      const need = Math.max(0,...s.topics.map(topic=>DAILY_CATEGORY_MIN-(counts[sourceCategory(topic)] || 0)));
      const seen = observed[s.id];
      const relevant = deficits.length ? deficits : DAILY_CATEGORIES.filter(k => categoryHasCapacity(k, counts[k] || 0));
      const observedYield = seen && seen.total >= 3
        ? 120 * relevant.reduce((n, category) => n + (seen.categories[category] || 0), 0) / seen.total
        : 0;
      return need * 40 + observedYield - (visits[s.id]?.visits || 0) * 9;
    };
    return score(b) - score(a);
  });
}
