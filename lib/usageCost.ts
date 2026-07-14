export interface ProviderTokenUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
}

export function estimateDeepSeekCostMicrousd(model: string, usage: ProviderTokenUsage): number {
  const flash = /flash|deepseek-chat/i.test(model);
  const hitRate = Number(process.env.DEEPSEEK_CACHE_HIT_USD_PER_MILLION ?? (flash ? 0.0028 : 0.003625));
  const missRate = Number(process.env.DEEPSEEK_CACHE_MISS_USD_PER_MILLION ?? (flash ? 0.14 : 0.435));
  const outputRate = Number(process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION ?? (flash ? 0.28 : 0.87));
  const prompt = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const hit = Math.max(0, Number(usage.prompt_cache_hit_tokens ?? 0));
  const miss = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit)));
  const output = Math.max(0, Number(usage.completion_tokens ?? 0));
  return Math.max(0, Math.round(hit * hitRate + miss * missRate + output * outputRate));
}
