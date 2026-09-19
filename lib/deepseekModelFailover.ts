const DEFAULT_PRIMARY_MODEL = "deepseek-v4-pro";

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

export function coreDeepSeekModelCandidates(
  primaryModel = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_PRIMARY_MODEL,
  _configuredFallbacks = process.env.DEEPSEEK_FALLBACK_MODELS,
): string[] {
  return uniqueModels([primaryModel]);
}

export function isRetryableDeepSeekStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface DeepSeekModelFailoverAttempt {
  model: string;
  status?: number;
  error?: unknown;
}

export interface DeepSeekModelFailoverResult {
  response: Response;
  model: string;
  errorBody: string;
}

export async function fetchWithDeepSeekModelFailover(options: {
  models: string[];
  attempt: (model: string) => Promise<Response>;
  requireBody?: boolean;
  onFailover?: (attempt: DeepSeekModelFailoverAttempt) => void | Promise<void>;
}): Promise<DeepSeekModelFailoverResult> {
  const models = uniqueModels(options.models);
  if (!models.length) {
    throw new Error("At least one DeepSeek model is required.");
  }

  const requireBody = options.requireBody ?? true;
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const hasFallback = index < models.length - 1;
    try {
      const response = await options.attempt(model);
      if (response.ok && (!requireBody || response.body)) {
        return { response, model: response.headers.get("x-context-model") || model, errorBody: "" };
      }

      const errorBody = await response.text().catch(() => "");
      if (hasFallback && (!response.body || isRetryableDeepSeekStatus(response.status))) {
        await options.onFailover?.({ model, status: response.status });
        continue;
      }

      return { response, model, errorBody };
    } catch (error) {
      lastError = error;
      if (!hasFallback || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      await options.onFailover?.({ model, error });
    }
  }

  throw lastError ?? new Error("DeepSeek model failover exhausted.");
}
