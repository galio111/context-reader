export const shanghaiDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export function countDailyPublications(ids: string[], selectedAt: Record<string, string>, day: string) {
  return [...new Set(ids)].filter(id => {
    const timestamp = Date.parse(selectedAt[id] || "");
    return Number.isFinite(timestamp) && shanghaiDay(new Date(timestamp)) === day;
  }).length;
}

/** Hidden or covered intervals never spend the visible notice budget. */
export class VisibleNoticeClock {
  elapsed = 0;
  private last: number | null = null;
  tick(now: number, visible: boolean) {
    if (visible && this.last !== null) this.elapsed += Math.max(0, now - this.last);
    this.last = visible ? now : null;
    return this.elapsed >= 2000;
  }
}
