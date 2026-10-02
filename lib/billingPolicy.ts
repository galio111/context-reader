export type PaidPlan = "basic" | "plus" | "max";
export type BillingTerm = "month" | "year";
export const BILLING_PLANS = ["free", "basic", "plus", "max"] as const;
export const PLAN_NAMES: Record<string, string> = { free: "免费账号", basic: "Basic", plus: "Plus", max: "Max", admin: "开发者账号" };
export function englishWordCount(text: string): number {
  return (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length;
}
export function learningPoints(feature: string, units = 1): number {
  if (feature === "standalone_dictionary") return 5;
  if (feature === "article_summary") return 2;
  if (feature === "full_article_translation") return Math.max(10, Math.ceil(units / 500) * 10);
  // Sentence follow-up retains its more expensive Pro model; explicitly priced.
  if (feature === "sentence_question") return 5;
  return 1;
}
export function remainingCredit(paidFen: number, timeRatio: number, quotaRatio: number): number {
  return Math.floor(paidFen * Math.max(0, Math.min(1, timeRatio, quotaRatio)));
}
export function addMemberMonths(iso: string, months: number): string {
  const source = new Date(iso);
  const sh = new Date(source.getTime() + 8 * 3600_000);
  const day = sh.getUTCDate();
  sh.setUTCDate(1);
  sh.setUTCMonth(sh.getUTCMonth() + months);
  const last = new Date(Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth() + 1, 0)).getUTCDate();
  sh.setUTCDate(Math.min(day, last));
  return new Date(sh.getTime() - 8 * 3600_000).toISOString();
}
