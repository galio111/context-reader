import type { PublicArticle } from "@/types/publicArticle";

export const REJECTION_REASONS = ["太专业或太难", "内容没兴趣", "广告或软文", "正文不完整或杂乱", "图片不合适", "与已有文章相似", "新闻过期或日期不可靠", "其他"] as const;
export type RejectionReason = typeof REJECTION_REASONS[number];
export function shanghaiDay(value: string | number | Date = Date.now()): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10) : "";
}
export function candidateOrder(articles: PublicArticle[], order: string[], now = Date.now()): PublicArticle[] {
  const today = shanghaiDay(now);
  const ranks = new Map(order.map((id, i) => [id, i]));
  return [...articles].sort((a, b) => {
    const aToday = shanghaiDay(a.createdAt) === today;
    const bToday = shanghaiDay(b.createdAt) === today;
    if (aToday !== bToday) return aToday ? -1 : 1;
    if (!aToday && order.length) {
      const difference = (ranks.get(a.id) ?? -1) - (ranks.get(b.id) ?? -1);
      if (difference) return difference;
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  });
}
export function freshnessFailure(dates: string[], timeSensitive: boolean, now = Date.now()): string {
  const parsed = dates.filter(Boolean).map(Date.parse).filter(Number.isFinite);
  if (parsed.some((date) => date > now + 3600_000)) return "发布日期在未来，需要核实";
  if (!timeSensitive) return "";
  if (!parsed.length) return "时事或商业文章缺少可靠发布日期";
  // An updated date must not make an old news story fresh again.
  return Math.min(...parsed) < now - 7 * 86400_000 ? "时事或商业文章已超过 7 天" : "";
}
export function similarArticle(a: string, b: string, threshold = 0.72): boolean {
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const left = words(a); const right = words(b);
  if (left.size < 5 || right.size < 5) return false;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / Math.max(left.size, right.size) >= threshold;
}
export function hasRecentPublishingCadence(values: string[], now = Date.now()): boolean {
  const dates = values.map(Date.parse).filter((time) => Number.isFinite(time) && time <= now && now - time <= 14 * 86400_000);
  if (!dates.length || now - Math.max(...dates) > 3 * 86400_000) return false;
  const days = [...new Set(dates.map((time) => shanghaiDay(time)))].sort().reverse();
  if (days.length < 2) return new Set(dates).size >= 6 && Math.max(...dates) - Math.min(...dates) >= 6 * 3600_000;
  const gaps = days.slice(1, 6).map((day, i) => (Date.parse(days[i]) - Date.parse(day)) / 86400_000).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] <= 3;
}
export function discoveryVisitLimit(target: number): number { return Math.max(3, Math.ceil(target / 3) + 2); }
export function minimumDiscoveryWords(levelHint?: string): number {
  void levelHint;
  return 401;
}
