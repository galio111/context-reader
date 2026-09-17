import type { UsageBalance } from "@/types/account";

export const usageMetricLabels: Record<string, string> = {
  guest_lookup: "游客查词",
  guest_article_lookup: "文章查词",
  guest_dictionary_lookup: "单独查词",
  guest_text_import: "正文导入",
  guest_url_import: "网址导入",
  lookup_generation: "查词与问答",
  deep_reading: "深度阅读",
  article_summary: "文章摘要",
  full_article_translation: "全文翻译",
};

export function usageResetLabel(windowEnd: string): string {
  const date = new Date(windowEnd);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date) + "（北京时间）";
}

export interface QuotaDetails extends UsageBalance {
  authenticated: boolean;
}

export function quotaExhaustedMessage(quota: QuotaDetails): string {
  const label = usageMetricLabels[quota.metricKey] || "当前功能";
  const reset = usageResetLabel(quota.windowEnd);
  const balance = quota.remaining > 0
    ? `${label}剩余 ${quota.remaining} 次，不足以完成本次操作。`
    : quota.allowance === 0
      ? `当前${quota.authenticated ? "账号" : "游客"}没有${label}额度。`
      : `${label}额度已用完（${quota.used} / ${quota.allowance}）。`;
  const recovery = reset && quota.allowance > 0 ? `${reset}重置。` : "";
  return balance + recovery + (quota.authenticated
    ? "可在用量页查看；仍可阅读文章和已有结果。"
    : "登录后可使用账号额度。");
}

export function lowUsageNotice(usage: UsageBalance[]): string {
  const eligible = usage.filter((item) => item.allowance > 0 && item.remaining / item.allowance <= 0.2);
  const low = eligible.find((item) => item.remaining === 0) || eligible[0];
  if (!low) return "";
  if (low.remaining === 0) return quotaExhaustedMessage({ ...low, authenticated: true });
  return `${usageMetricLabels[low.metricKey] || "当前功能"}剩余 ${low.remaining} / ${low.allowance}，已不超过 20%。`;
}

export class LookupQuotaError extends Error {
  constructor(message?: string) {
    super(message || "当前查词额度不足，请查看用量详情。");
    this.name = "LookupQuotaError";
  }
}
