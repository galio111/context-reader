import { DAILY_CATEGORIES, DAILY_CATEGORY_MAX, DAILY_CATEGORY_MIN } from "./editorialDistribution";

type Category = (typeof DAILY_CATEGORIES)[number];
type Site = { id: string; topics: string[]; levelHint?: string; enabled: boolean; verification?: { ok: boolean } };
type Visit = { visits: number; empty?: number };

export function sourceCategory(topic: string): Category {
  if (topic === "商业经济") return "商业";
  if (topic === "社会生活") return "时事";
  if (topic === "科技科学" || topic === "自然环境") return "科技";
  return "文化";
}

/** Fill unmet category minimums before spending attempts on optional surplus. */
export function rankEditorialSources<T extends Site>(
  sites: T[], counts: Record<string, number>, visits: Record<string, Visit>,
  observed: Record<string, { matched: number; total: number }> = {},
): T[] {
  const available = sites.filter(s => s.enabled && s.verification?.ok && s.levelHint !== "lower"
    && (visits[s.id]?.visits || 0) < 6 && (visits[s.id]?.empty || 0) < 2);
  const deficits = DAILY_CATEGORIES.filter(category => (counts[category] || 0) < DAILY_CATEGORY_MIN);
  let pool: T[];
  if (deficits.length) {
    const primary = available.filter(s => deficits.includes(sourceCategory(s.topics[0])));
    pool = primary.length ? primary : available.filter(s => s.topics.some(t => deficits.includes(sourceCategory(t))));
  } else {
    pool = available.filter(s => (counts[sourceCategory(s.topics[0])] || 0) < DAILY_CATEGORY_MAX);
  }
  return pool.sort((a, b) => {
    const score = (s: T) => {
      const category = sourceCategory(s.topics[0]);
      const need = Math.max(0, DAILY_CATEGORY_MIN - (counts[category] || 0));
      const seen = observed[s.id];
      const observedYield = seen && seen.total >= 3 ? 20 * seen.matched / seen.total : 0;
      return need * 40 + observedYield - (visits[s.id]?.visits || 0) * 9;
    };
    return score(b) - score(a);
  });
}
