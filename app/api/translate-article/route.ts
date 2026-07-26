import { NextResponse } from "next/server";
import { createHash } from "crypto";
import type { ArticleTranslationBlock, ArticleTranslationResult } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlotWithWait } from "@/lib/costConcurrency";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { deepReadingUnits, gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_BLOCKS = 80;
const MAX_BLOCK_CHARS = 900;
const MAX_TOTAL_CHARS = 16000;
const REQUEST_TIMEOUT_MS = 45000;

const TRANSLATION_SYSTEM_PROMPT =
  'You are a rigorous English-to-Chinese long-form contextual translation assistant. The input "target" is the set of article blocks that must be translated now, and "context" is the full current article context. Read the full context first, keep names, terms, pronouns, tense, and logical connections consistent, then translate only target. Preserve target order and ids. Do not omit information, add explanations, or output Markdown. Return strict JSON only: {"translations":[{"id":"original id","translation":"Chinese translation"}]}.';

export const maxDuration = 60;

interface DeepSeekTranslationResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderTokenUsage;
}

interface TranslationRequestBody {
  blocks?: ArticleTranslationBlock[];
  contextBlocks?: ArticleTranslationBlock[];
}

function isTranslationBlock(value: unknown): value is ArticleTranslationBlock {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ArticleTranslationBlock>;
  return typeof candidate.id === "string" && typeof candidate.type === "string" && typeof candidate.text === "string";
}

function sanitizeBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[] {
  let totalChars = 0;
  return blocks.slice(0, MAX_BLOCKS).map((block) => {
    const text = block.text.trim().slice(0, MAX_BLOCK_CHARS);
    totalChars += text.length;
    return {
      id: block.id,
      type: block.type,
      text,
    };
  }).filter((block) => {
    if (!block.text) {
      return false;
    }
    if (totalChars > MAX_TOTAL_CHARS) {
      totalChars -= block.text.length;
      return false;
    }
    return true;
  });
}

function parseJsonObject(raw: string): ArticleTranslationResult {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as Partial<ArticleTranslationResult>;
  const translations = Array.isArray(parsed.translations)
    ? parsed.translations
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const candidate = item as Partial<ArticleTranslationResult["translations"][number]>;
          return {
            id: String(candidate.id ?? ""),
            translation: String(candidate.translation ?? "").trim(),
          };
        })
        .filter((item) => item.id && item.translation)
    : [];

  return { translations };
}

function providerError(message: string, status: number): { error: string; code: string; status: number } {
  const normalized = message.toLowerCase();
  if (status === 402 || normalized.includes("insufficient balance")) {
    return { error: "AI 服务余额不足，全文翻译暂不可用，请联系管理员补充余额。", code: "provider_balance", status: 503 };
  }
  if (status === 429 || normalized.includes("rate limit")) {
    return { error: "AI 服务正在排队，全文翻译会自动继续。", code: "provider_rate_limit", status: 503 };
  }
  if (status === 500 || status === 503 || normalized.includes("overloaded")) {
    return { error: "AI 服务短暂波动，全文翻译会自动继续。", code: "provider_temporary", status: 503 };
  }
  if (normalized.includes("unauthorized") || normalized.includes("invalid api key")) {
    return { error: "AI 服务配置无效，请联系管理员检查 API 配置。", code: "provider_config", status: 503 };
  }
  return { error: "全文翻译生成失败，请稍后重试。", code: "provider_error", status: Math.max(400, status || 502) };
}

export async function POST(request: Request) {
  let actionId = "";
  let usageSucceeded = false;
  let providerUserId = "";
  let input: TranslationRequestBody;
  try {
    input = await readJsonBody<TranslationRequestBody>(request, 512 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "Request body is too large." : "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  if (!Array.isArray(input.blocks) || !input.blocks.every(isTranslationBlock)) {
    return NextResponse.json({ error: "Missing article blocks." }, { status: 400 });
  }

  const blocks = sanitizeBlocks(input.blocks);
  const contextBlocks =
    Array.isArray(input.contextBlocks) && input.contextBlocks.every(isTranslationBlock)
      ? sanitizeBlocks(input.contextBlocks)
      : blocks;

  if (!blocks.length) {
    return NextResponse.json({ error: "No translatable article text found." }, { status: 400 });
  }


  try {
    const usageGate = await gateUsage(request, {
      feature: "full_article_translation",
      metricKey: "deep_reading",
      units: deepReadingUnits(blocks.reduce((sum, block) => sum + block.text.length, 0)),
      loginRequired: true,
    });
    actionId = usageGate.actionId;
    providerUserId = createHash("sha256").update(usageGate.identity.ownerKey).digest("hex").slice(0, 32);
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "Usage validation failed." }, { status: 500 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    await refundUsage(actionId, "failed", "missing_api_key").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "configuration",
      severity: "critical",
      operation: "article_translation",
      endpoint: "/api/translate-article",
      userMessage: "全文翻译暂时不可用，开发者已收到异常并正在处理。",
      technicalMessage: "DEEPSEEK_API_KEY is not configured.",
      code: "missing_api_key",
      httpStatus: 500,
    });
    return NextResponse.json(
      { error: "全文翻译暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 500 },
    );
  }

  const releaseSlot = await acquireCostSlotWithWait("ai", 8, {
    signal: request.signal,
    timeoutMs: 8_000,
  });
  if (!releaseSlot) {
    await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "service",
      severity: "warning",
      operation: "article_translation",
      endpoint: "/api/translate-article",
      userMessage: "全文翻译当前正在排队，请稍后重试。",
      technicalMessage: "Local AI concurrency wait timed out.",
      code: "local_concurrency",
      httpStatus: 503,
      metadata: { blockCount: blocks.length },
    });
    return NextResponse.json(
      { error: "AI 服务正在排队，全文翻译会自动继续。", code: "local_concurrency", ...reportReference(report) },
      { status: 503, headers: { "Retry-After": "3" } },
    );
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_TRANSLATION_MODEL || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        user_id: providerUserId,
        temperature: 0,
        max_tokens: 3600,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content: TRANSLATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              target: blocks.map((block) => [block.id, block.type, block.text]),
              context: contextBlocks.map((block) => [block.id, block.type, block.text]),
            }),
          },
        ],
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as DeepSeekTranslationResponse;
    if (!response.ok) {
      const errorMessage = data.error?.message || response.statusText || "DeepSeek request failed.";
      const classified = providerError(errorMessage, response.status);
      const retryAfter = response.headers.get("Retry-After");
      const report = await recordServerError(request, {
        category: classified.code === "provider_config" ? "configuration" : "provider",
        severity: classified.code === "provider_config" || classified.code === "provider_balance" ? "critical" : "error",
        operation: "article_translation",
        endpoint: "/api/translate-article",
        userMessage: classified.error,
        technicalMessage: `DeepSeek translation rejected: HTTP ${response.status}. ${errorMessage.slice(0, 2_000)}`,
        code: classified.code,
        httpStatus: classified.status,
        metadata: { providerStatus: response.status, model, blockCount: blocks.length },
      });
      return NextResponse.json(
        { error: classified.error, code: classified.code, ...reportReference(report) },
        {
          status: classified.status,
          headers: classified.code === "provider_rate_limit" || classified.code === "provider_temporary"
            ? { "Retry-After": retryAfter && /^\d+$/.test(retryAfter) ? retryAfter : "5" }
            : undefined,
        },
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const report = await recordServerError(request, {
        category: "provider",
        operation: "article_translation",
        endpoint: "/api/translate-article",
        userMessage: "AI 服务返回了空结果，全文翻译会自动继续。",
        technicalMessage: "DeepSeek returned no translation message content.",
        code: "provider_empty",
        httpStatus: 503,
        metadata: { model, blockCount: blocks.length },
      });
      return NextResponse.json(
        { error: "AI 服务返回了空结果，全文翻译会自动继续。", code: "provider_temporary", ...reportReference(report) },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }

    let result: ArticleTranslationResult;
    try {
      result = parseJsonObject(content);
    } catch (parseError) {
      const report = await recordServerError(request, {
        category: "provider",
        operation: "article_translation",
        endpoint: "/api/translate-article",
        userMessage: "AI 服务返回格式异常，全文翻译会自动继续。",
        technicalMessage: `Translation JSON parse failed. Response excerpt: ${content.slice(0, 2_000)}`,
        code: "provider_parse_error",
        httpStatus: 503,
        metadata: { model, blockCount: blocks.length },
      }, parseError);
      return NextResponse.json(
        { error: "AI 服务返回格式异常，全文翻译会自动继续。", code: "provider_temporary", ...reportReference(report) },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }
    const requestedIds = new Set(blocks.map((block) => block.id));
    result = {
      translations: result.translations.filter((translation) => requestedIds.has(translation.id)),
    };
    const translatedIds = new Set(result.translations.map((translation) => translation.id));
    if (!result.translations.length || blocks.some((block) => !translatedIds.has(block.id))) {
      const report = await recordServerError(request, {
        category: "provider",
        operation: "article_translation",
        endpoint: "/api/translate-article",
        userMessage: "AI 服务没有返回完整译文，全文翻译会自动继续。",
        technicalMessage: `Translation result missed requested blocks: requested=${blocks.length}, returned=${result.translations.length}.`,
        code: "provider_incomplete",
        httpStatus: 503,
        metadata: { model, requestedBlocks: blocks.length, translatedBlocks: result.translations.length },
      });
      return NextResponse.json(
        { error: "AI 服务没有返回可用译文，全文翻译会自动继续。", code: "provider_temporary", ...reportReference(report) },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }

    usageSucceeded = true;
    await recordUsageExecution({ actionId, route: "/api/translate-article", provider: "deepseek", model, promptTokens: data.usage?.prompt_tokens, promptCacheHitTokens: data.usage?.prompt_cache_hit_tokens, promptCacheMissTokens: data.usage?.prompt_cache_miss_tokens, completionTokens: data.usage?.completion_tokens, estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, data.usage ?? {}), status: "succeeded" }).catch(() => undefined);
    await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const report = await recordServerError(request, {
      category: "provider",
      operation: "article_translation",
      endpoint: "/api/translate-article",
      userMessage: timedOut ? "AI 服务响应较慢，全文翻译会自动继续。" : "AI 服务连接短暂中断，全文翻译会自动继续。",
      code: timedOut ? "provider_timeout" : "provider_connection_failed",
      httpStatus: 503,
      metadata: { model, blockCount: blocks.length },
    }, error);
    return NextResponse.json(
      {
        error: timedOut ? "AI 服务响应较慢，全文翻译会自动继续。" : "AI 服务连接短暂中断，全文翻译会自动继续。",
        code: "provider_temporary",
        ...reportReference(report),
      },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  } finally {
    if (!usageSucceeded) {
      await refundUsage(actionId, "failed", "translation_failed").catch(() => undefined);
    }
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
  }
}
