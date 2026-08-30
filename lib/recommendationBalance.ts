import { EDITORIAL_CATEGORIES, editorialCategoryForArticle, type EditorialCategory } from "@/lib/editorialCuration";
import type { ArticleTopic, PublicArticle } from "@/types/publicArticle";

const CATEGORY_TOPICS: Record<EditorialCategory, ArticleTopic[]> = {
  时事: ["社会生活"],
  科技: ["科技科学", "自然环境"],
  文化: ["文化历史", "人物成长", "故事文学"],
  商业: ["商业经济"],
};

export interface RecommendationBalanceSlot {
  category: EditorialCategory;
  topic: ArticleTopic;
  beforeCount: number;
}

export interface RecommendationBalancePlanItem {
  category: EditorialCategory;
  topic: ArticleTopic;
  targetCount: number;
  beforeCount: number;
}

function shanghaiDayNumber(now: Date): number {
  return Math.floor((now.getTime() + 8 * 60 * 60 * 1000) / 86_400_000);
}

export function countRecommendationInventory(
  candidates: PublicArticle[],
  published: PublicArticle[],
): Record<EditorialCategory, number> {
  const unique = new Map([...published, ...candidates].map((article) => [article.id, article]));
  const counts = Object.fromEntries(EDITORIAL_CATEGORIES.map((category) => [category, 0])) as Record<EditorialCategory, number>;
  for (const article of unique.values()) counts[editorialCategoryForArticle(article)] += 1;
  return counts;
}

export function buildBalancedRecommendationPlan(
  candidates: PublicArticle[],
  published: PublicArticle[],
  targetCount: number,
  now: Date,
): RecommendationBalancePlanItem[] {
  const counts = countRecommendationInventory(candidates, published);
  const projected = { ...counts };
  const day = shanghaiDayNumber(now);
  const tieOrder = EDITORIAL_CATEGORIES.map((_, index) => EDITORIAL_CATEGORIES[(index + day) % EDITORIAL_CATEGORIES.length]);
  const slots: RecommendationBalanceSlot[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const minimum = Math.min(...EDITORIAL_CATEGORIES.map((category) => projected[category]));
    const category = tieOrder.find((candidate) => projected[candidate] === minimum) ?? EDITORIAL_CATEGORIES[0];
    const topics = CATEGORY_TOPICS[category];
    const topic = topics[(day + projected[category]) % topics.length];
    slots.push({ category, topic, beforeCount: counts[category] });
    projected[category] += 1;
  }

  const grouped = new Map<string, RecommendationBalancePlanItem>();
  for (const slot of slots) {
    const key = `${slot.category}:${slot.topic}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...current, targetCount: current.targetCount + 1 }
      : { ...slot, targetCount: 1 });
  }
  return [...grouped.values()];
}
