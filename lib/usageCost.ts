export interface ProviderTokenUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
}

interface DeepSeekRates {
  hit: number;
  miss: number;
  output: number;
}

const PEAK_PRICING_EFFECTIVE_AT = Date.parse("2026-08-16T16:00:00Z");
export const DEFAULT_DEEPSEEK_USD_TO_CNY_RATE = 7.2;

function configuredRate(name: string): number | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isDeepSeekPeakTime(at: Date): boolean {
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
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
