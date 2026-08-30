export interface ProviderTokenUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
}

export interface UsageExecutionSummaryRow extends ProviderTokenUsage {
  model?: string;
  route?: string;
  status?: string;
  created_at?: string;
}

export interface DailyUsageSummary {
  date: string;
  executions: number;
  failed: number;
  failureRate: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostMicrousd: number;
  estimatedCostMicrocny: number;
  estimatedCostCny: number;
}

export interface UsageFeatureSummary extends Omit<DailyUsageSummary, "date"> {
  key: string;
  label: string;
}

interface DeepSeekRates {
  hit: number;
  miss: number;
  output: number;
}

const PEAK_PRICING_EFFECTIVE_AT = Date.parse("2026-08-16T16:00:00Z");
const WEEKEND_OFF_PEAK_EFFECTIVE_AT = Date.parse("2026-08-22T16:00:00Z");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
export const DEFAULT_DEEPSEEK_USD_TO_CNY_RATE = 7.2;

function configuredRate(name: string): number | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isDeepSeekPeakTime(at: Date): boolean {
  const hour = at.getUTCHours();
  const inPeakHours = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  if (!inPeakHours || at.getTime() < WEEKEND_OFF_PEAK_EFFECTIVE_AT) return inPeakHours;
  const shanghaiDay = new Date(at.getTime() + SHANGHAI_OFFSET_MS).getUTCDay();
  return shanghaiDay !== 0 && shanghaiDay !== 6;
}

export function deepSeekRatesAt(model: string, at: Date): DeepSeekRates {
  const flash = /flash|deepseek-chat/i.test(model);
  const configured = {
    hit: configuredRate("DEEPSEEK_CACHE_HIT_USD_PER_MILLION"),
    miss: configuredRate("DEEPSEEK_CACHE_MISS_USD_PER_MILLION"),
    output: configuredRate("DEEPSEEK_OUTPUT_USD_PER_MILLION"),
  };
  if (configured.hit !== null && configured.miss !== null && configured.output !== null) {
    return { hit: configured.hit, miss: configured.miss, output: configured.output };
  }
  if (at.getTime() < PEAK_PRICING_EFFECTIVE_AT) {
    return flash
      ? { hit: 0.0028, miss: 0.14, output: 0.28 }
      : { hit: 0.003625, miss: 0.435, output: 0.87 };
  }
  const offPeak = flash
    ? { hit: 0.007, miss: 0.22, output: 0.66 }
    : { hit: 0.022, miss: 0.66, output: 1.98 };
  const multiplier = isDeepSeekPeakTime(at) ? 2 : 1;
  return {
    hit: offPeak.hit * multiplier,
    miss: offPeak.miss * multiplier,
    output: offPeak.output * multiplier,
  };
}

export function estimateDeepSeekCostMicrousd(model: string, usage: ProviderTokenUsage, at = new Date()): number {
  const rates = deepSeekRatesAt(model, at);
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const hit = Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0));
  const miss = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit)));
  const output = Math.max(0, Number(usage.completion_tokens ?? 0));
  return Math.max(0, Math.round(hit * rates.hit + miss * rates.miss + output * rates.output));
}

export function deepSeekUsdToCnyRate(): number {
  return configuredRate("DEEPSEEK_USD_TO_CNY_RATE") ?? DEFAULT_DEEPSEEK_USD_TO_CNY_RATE;
}

export function microusdToCny(microusd: number, rate = deepSeekUsdToCnyRate()): number {
  return Math.max(0, Number(microusd) || 0) * rate / 1_000_000;
}

function deepSeekCnyRatesAt(model: string, at: Date): DeepSeekRates {
  const flash = /flash|deepseek-chat/i.test(model);
  if (at.getTime() < PEAK_PRICING_EFFECTIVE_AT) {
    return flash
      ? { hit: 0.02, miss: 1, output: 2 }
      : { hit: 0.025, miss: 3, output: 6 };
  }
  const offPeak = flash
    ? { hit: 0.05, miss: 1.5, output: 4.5 }
    : { hit: 0.15, miss: 4.5, output: 13.5 };
  const multiplier = isDeepSeekPeakTime(at) ? 2 : 1;
  return {
    hit: offPeak.hit * multiplier,
    miss: offPeak.miss * multiplier,
    output: offPeak.output * multiplier,
  };
}

export function estimateDeepSeekCostMicrocny(model: string, usage: ProviderTokenUsage, at = new Date()): number {
  const rates = deepSeekCnyRatesAt(model, at);
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const hit = Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0));
  const miss = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit)));
  const output = Math.max(0, Number(usage.completion_tokens ?? 0));
  return Math.max(0, Math.round(hit * rates.hit + miss * rates.miss + output * rates.output));
}

export function microcnyToCny(microcny: number): number {
  return Math.max(0, Number(microcny) || 0) / 1_000_000;
}

function shanghaiDayKey(at: Date): string {
  return new Date(at.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDayKey(dayKey: string, offsetDays: number): string {
  const day = new Date(`${dayKey}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

export function shanghaiUsageWindow(windowEnd = new Date(), windowDays = 30): {
  windowStart: string;
  windowEnd: string;
  dayKeys: string[];
} {
  const safeWindowDays = Math.max(1, Math.floor(windowDays));
  const end = Number.isFinite(windowEnd.getTime()) ? windowEnd : new Date();
  const todayKey = shanghaiDayKey(end);
  const dayKeys = Array.from({ length: safeWindowDays }, (_, index) => shiftDayKey(todayKey, -index));
  const oldestDayKey = dayKeys[dayKeys.length - 1];
  return {
    windowStart: new Date(`${oldestDayKey}T00:00:00+08:00`).toISOString(),
    windowEnd: end.toISOString(),
    dayKeys,
  };
}

export function summarizeUsageExecutionsByShanghaiDay(
  executions: UsageExecutionSummaryRow[],
  dayKeys: string[],
): DailyUsageSummary[] {
  const buckets = new Map(dayKeys.map((date) => [date, {
    date,
    executions: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostMicrousd: 0,
    estimatedCostMicrocny: 0,
  }]));

  for (const execution of executions) {
    const createdAt = new Date(String(execution.created_at || ""));
    if (!Number.isFinite(createdAt.getTime())) continue;
    const bucket = buckets.get(shanghaiDayKey(createdAt));
    if (!bucket) continue;
    bucket.executions += 1;
    if (execution.status === "failed") bucket.failed += 1;
    bucket.promptTokens += Math.max(0, Number(execution.prompt_tokens || 0));
    bucket.completionTokens += Math.max(0, Number(execution.completion_tokens || 0));
    bucket.estimatedCostMicrousd += estimateDeepSeekCostMicrousd(
      String(execution.model || "deepseek-v4-pro"),
      execution,
      createdAt,
    );
    bucket.estimatedCostMicrocny += estimateDeepSeekCostMicrocny(
      String(execution.model || "deepseek-v4-pro"),
      execution,
      createdAt,
    );
  }

  return dayKeys.map((date) => {
    const bucket = buckets.get(date)!;
    return {
      ...bucket,
      failureRate: bucket.executions ? bucket.failed / bucket.executions : 0,
      estimatedCostCny: microcnyToCny(bucket.estimatedCostMicrocny),
    };
  });
}

const USAGE_FEATURES: Array<{ key: string; label: string; routes: string[] }> = [
  { key: "translation", label: "全文翻译", routes: ["/api/translate-article"] },
  { key: "article_lookup", label: "文章查词", routes: ["/api/explain-word", "/api/explain-word-stream"] },
  { key: "dictionary", label: "单独查词", routes: ["/api/dictionary", "/api/dictionary-stream"] },
  { key: "summary", label: "文章摘要", routes: ["/api/summarize-article"] },
  { key: "sentence_question", label: "句子追问", routes: ["/api/ask-sentence"] },
  { key: "recommendation_analysis", label: "推荐文章分析", routes: ["/api/admin/article-classification", "/api/admin/article-crawler"] },
];

function usageFeatureForRoute(route: string): { key: string; label: string } {
  return USAGE_FEATURES.find((feature) => feature.routes.includes(route)) ?? { key: "other", label: "其他调用" };
}

export function summarizeUsageExecutionsByFeature(executions: UsageExecutionSummaryRow[]): UsageFeatureSummary[] {
  const buckets = new Map<string, UsageFeatureSummary>();
  for (const execution of executions) {
    const createdAt = new Date(String(execution.created_at || ""));
    if (!Number.isFinite(createdAt.getTime())) continue;
    const feature = usageFeatureForRoute(String(execution.route || ""));
    const bucket = buckets.get(feature.key) ?? {
      ...feature,
      executions: 0,
      failed: 0,
      failureRate: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostMicrousd: 0,
      estimatedCostMicrocny: 0,
      estimatedCostCny: 0,
    };
    bucket.executions += 1;
    if (execution.status === "failed") bucket.failed += 1;
    bucket.promptTokens += Math.max(0, Number(execution.prompt_tokens || 0));
    bucket.completionTokens += Math.max(0, Number(execution.completion_tokens || 0));
    bucket.estimatedCostMicrousd += estimateDeepSeekCostMicrousd(String(execution.model || "deepseek-v4-pro"), execution, createdAt);
    bucket.estimatedCostMicrocny += estimateDeepSeekCostMicrocny(String(execution.model || "deepseek-v4-pro"), execution, createdAt);
    buckets.set(feature.key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      failureRate: bucket.executions ? bucket.failed / bucket.executions : 0,
      estimatedCostCny: microcnyToCny(bucket.estimatedCostMicrocny),
    }))
    .sort((left, right) => right.estimatedCostMicrocny - left.estimatedCostMicrocny || right.executions - left.executions);
}
