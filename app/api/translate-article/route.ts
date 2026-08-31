import { NextResponse } from "next/server";
import { createHash } from "crypto";
import type { ArticleTranslationBlock, ArticleTranslationResult } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlotWithWait } from "@/lib/costConcurrency";
import { finishUsage, getUsageAction, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { deepReadingUnits, gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { resolveUsageIdentity } from "@/lib/usageIdentity";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";
import { IncrementalJsonObjectParser } from "@/lib/incrementalJsonObjects";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_TARGET_BLOCKS = 80;
const MAX_CONTEXT_BLOCKS = 240;
const MAX_BLOCK_CHARS = 900;
const MAX_TARGET_TOTAL_CHARS = 32_000;
const MAX_CONTEXT_TOTAL_CHARS = 64_000;
const REQUEST_TIMEOUT_MS = 120000;

const TRANSLATION_SYSTEM_PROMPT =
  'You are a rigorous English-to-Chinese long-form contextual translation assistant. The input "target" is the set of article blocks that must be translated now, and "context" is the full current article context. Read the full context first, keep names, terms, pronouns, tense, and logical connections consistent, then translate only target. Preserve target order and ids. Do not omit information, add explanations, or output Markdown. Return strict JSON only: {"translations":[{"id":"original id","translation":"Chinese translation"}]}.';

const STREAMING_TRANSLATION_SYSTEM_PROMPT =
  'You are a rigorous English-to-Chinese long-form contextual translation assistant. Translate every target block in its original order. If context is empty, target itself is the complete article context; otherwise read the supplied full context before translating target. Keep names, terms, pronouns, tense, and logical connections consistent. Do not omit information or add explanations. Stream one complete JSON object per line as soon as each block is translated, with exactly this shape: {"id":"original id","translation":"Chinese translation"}. Use one physical line per object, escape any newline inside a JSON string, and output no array, Markdown fence, commentary, blank line, or extra key.';

export const maxDuration = 180;

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

interface DeepSeekTranslationStreamChunk {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: ProviderTokenUsage | null;
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

function sanitizeBlocks(blocks: ArticleTranslationBlock[], maxBlocks: number, maxTotalChars: number): ArticleTranslationBlock[] {
  let totalChars = 0;
  return blocks.slice(0, maxBlocks).map((block) => {
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
    if (totalChars > maxTotalChars) {
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
  let managedTranslationAction = false;
  let localOnlyAction = false;
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

  const blocks = sanitizeBlocks(input.blocks, MAX_TARGET_BLOCKS, MAX_TARGET_TOTAL_CHARS);
  const contextBlocks =
    Array.isArray(input.contextBlocks) && input.contextBlocks.every(isTranslationBlock)
      ? sanitizeBlocks(input.contextBlocks, MAX_CONTEXT_BLOCKS, MAX_CONTEXT_TOTAL_CHARS)
      : blocks;

  if (!blocks.length) {
    return NextResponse.json({ error: "No translatable article text found." }, { status: 400 });
  }

  const contextMatchesTarget = blocks.length === contextBlocks.length && blocks.every((block, index) => (
    block.id === contextBlocks[index]?.id
    && block.type === contextBlocks[index]?.type
    && block.text === contextBlocks[index]?.text
  ));
  const providerContextBlocks = contextMatchesTarget ? [] : contextBlocks;


  const managedActionId = request.headers.get("x-context-translation-action-id")?.trim() ?? "";
  if (managedActionId) {
    try {
      const identity = await resolveUsageIdentity(request);
      if (!identity.authenticated || identity.suspended) {
        return NextResponse.json({ error: "全文翻译任务未获得账号授权。" }, { status: 403 });
      }
      localOnlyAction = Boolean(identity.localOnly);
      if (!localOnlyAction) {
        const action = await getUsageAction(managedActionId);
        if (
          !action
          || action.ownerKey !== identity.ownerKey
          || action.feature !== "full_article_translation"
          || action.metricKey !== "full_article_translation"
          || action.status !== "reserved"
        ) {
          return NextResponse.json({ error: "全文翻译任务已失效，请重新开始。" }, { status: 409 });
        }
      }
      actionId = managedActionId;
      managedTranslationAction = true;
      providerUserId = createHash("sha256").update(identity.ownerKey).digest("hex").slice(0, 32);
    } catch {
      return NextResponse.json({ error: "全文翻译任务校验失败，请稍后重试。" }, { status: 503 });
    }
  } else {
    try {
      const usageGate = await gateUsage(request, {
        feature: "full_article_translation",
        metricKey: "deep_reading",
        units: deepReadingUnits(blocks.reduce((sum, block) => sum + block.text.length, 0)),
        loginRequired: true,
      });
      actionId = usageGate.actionId;
      localOnlyAction = Boolean(usageGate.identity.localOnly);
      providerUserId = createHash("sha256").update(usageGate.identity.ownerKey).digest("hex").slice(0, 32);
    } catch (error) {
      return usageErrorResponse(error) ?? NextResponse.json({ error: "Usage validation failed." }, { status: 500 });
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    if (!managedTranslationAction) await refundUsage(actionId, "failed", "missing_api_key").catch(() => undefined);
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
    if (!managedTranslationAction) await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
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
  const model = process.env.DEEPSEEK_TRANSLATION_MODEL || "deepseek-v4-flash";
  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const recordFailedProviderExecution = async (errorCode: string, usage: ProviderTokenUsage = {}) => {
    if (localOnlyAction) return;
    await recordUsageExecution({
      actionId,
      route: "/api/translate-article",
      provider: "deepseek",
      model,
      promptTokens: usage.prompt_tokens,
      promptCacheHitTokens: usage.prompt_cache_hit_tokens,
      promptCacheMissTokens: usage.prompt_cache_miss_tokens,
      completionTokens: usage.completion_tokens,
      estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, usage),
      status: "failed",
      errorCode,
    }).catch(() => undefined);
  };

  if (request.headers.get("Accept")?.includes("application/x-ndjson")) {
    let providerResponse: Response;
    try {
      providerResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          user_id: providerUserId,
          temperature: 0,
          max_tokens: Math.min(12_000, Math.max(3_600, Math.ceil(blocks.reduce((sum, block) => sum + block.text.length, 0) * 0.8))),
          thinking: { type: "disabled" },
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: STREAMING_TRANSLATION_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                target: blocks.map((block) => [block.id, block.type, block.text]),
                context: providerContextBlocks.map((block) => [block.id, block.type, block.text]),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      await recordFailedProviderExecution(timedOut ? "provider_timeout" : "provider_connection_failed");
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromClient);
      releaseSlot();
      return NextResponse.json(
        { error: timedOut ? "AI 服务响应较慢，全文翻译会自动继续。" : "AI 服务连接短暂中断，全文翻译会自动继续。", code: "provider_temporary" },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }

    if (!providerResponse.ok || !providerResponse.body) {
      const data = (await providerResponse.json().catch(() => ({}))) as DeepSeekTranslationResponse;
      const classified = providerError(data.error?.message || providerResponse.statusText, providerResponse.status);
      await recordFailedProviderExecution(classified.code, data.usage);
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromClient);
      releaseSlot();
      return NextResponse.json(
        { error: classified.error, code: classified.code },
        { status: classified.status, headers: { "Retry-After": "5" } },
      );
    }

    const requestedIds = new Set(blocks.map((block) => block.id));
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const providerReader = providerResponse.body!.getReader();
        const decoder = new TextDecoder();
        let providerBuffer = "";
        let fullContent = "";
        let usage: ProviderTokenUsage = {};
        const completedIds = new Set<string>();
        let streamErrorCode = "";
        const jsonObjects = new IncrementalJsonObjectParser();

        const emitTranslation = (item: { id?: unknown; translation?: unknown }) => {
          const id = typeof item.id === "string" ? item.id : "";
          const translation = typeof item.translation === "string" ? item.translation.trim() : "";
          if (!requestedIds.has(id) || !translation || completedIds.has(id)) return;
          completedIds.add(id);
          output.enqueue(encoder.encode(`${JSON.stringify({ type: "translation", translation: { id, translation } })}\n`));
        };

        const emitTranslationPayload = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          const object = value as { id?: unknown; translation?: unknown; translations?: unknown };
          emitTranslation(object);
          if (Array.isArray(object.translations)) {
            for (const item of object.translations) {
              if (item && typeof item === "object") emitTranslation(item as { id?: unknown; translation?: unknown });
            }
          }
        };

        const emitFallbackDocument = () => {
          const unfenced = fullContent.trim().replace(/^```(?:jsonl?|ndjson)?\s*/i, "").replace(/```$/, "").trim();
          try {
            const parsed = JSON.parse(unfenced) as unknown;
            const items = Array.isArray(parsed)
              ? parsed
              : parsed && typeof parsed === "object" && Array.isArray((parsed as { translations?: unknown }).translations)
                ? (parsed as { translations: unknown[] }).translations
                : [];
            for (const item of items) {
              if (item && typeof item === "object") emitTranslation(item as { id?: unknown; translation?: unknown });
            }
          } catch {
            // The primary JSONL parser remains authoritative when the provider returned partial or malformed data.
          }
        };

        try {
          while (true) {
            const { done, value } = await providerReader.read();
            providerBuffer += decoder.decode(value, { stream: !done });
            const events = providerBuffer.split(/\r?\n\r?\n/);
            providerBuffer = done ? "" : events.pop() ?? "";
            for (const event of events) {
              for (const line of event.split(/\r?\n/)) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                const chunk = JSON.parse(payload) as DeepSeekTranslationStreamChunk;
                if (chunk.usage) usage = chunk.usage;
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  for (const object of jsonObjects.push(delta)) emitTranslationPayload(object);
                }
              }
            }
            if (done) break;
          }
          if (completedIds.size < blocks.length) emitFallbackDocument();
          if (completedIds.size === blocks.length) streamErrorCode = "";
          const missing = blocks.filter((block) => !completedIds.has(block.id));
          if (missing.length || streamErrorCode) {
            streamErrorCode ||= "provider_incomplete";
            await recordFailedProviderExecution(streamErrorCode, usage);
            const error = completedIds.size > 0
              ? `AI 生成中断，本次已生成 ${completedIds.size}/${blocks.length} 段。`
              : "AI 生成中断，本次未生成可用译文。";
            output.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error, code: "provider_temporary" })}\n`));
          } else {
            usageSucceeded = true;
            if (!localOnlyAction) {
              await recordUsageExecution({ actionId, route: "/api/translate-article", provider: "deepseek", model, promptTokens: usage.prompt_tokens, promptCacheHitTokens: usage.prompt_cache_hit_tokens, promptCacheMissTokens: usage.prompt_cache_miss_tokens, completionTokens: usage.completion_tokens, estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, usage), status: "succeeded" }).catch(() => undefined);
            }
            if (!managedTranslationAction) await finishUsage(actionId, "succeeded").catch(() => undefined);
            output.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
          }
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "AbortError";
          await recordFailedProviderExecution(timedOut ? "provider_timeout" : "provider_stream_failed", usage);
          const progress = completedIds.size > 0
            ? `本次已生成 ${completedIds.size}/${blocks.length} 段。`
            : "本次未生成可用译文。";
          output.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: `${timedOut ? "AI 服务响应超时" : "AI 服务连接中断"}，${progress}`, code: "provider_temporary" })}\n`));
        } finally {
          if (!usageSucceeded && !managedTranslationAction) await refundUsage(actionId, "failed", streamErrorCode || "translation_failed").catch(() => undefined);
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", abortFromClient);
          releaseSlot();
          output.close();
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

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
              context: providerContextBlocks.map((block) => [block.id, block.type, block.text]),
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
      await recordFailedProviderExecution(classified.code, data.usage);
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
      await recordFailedProviderExecution("provider_empty", data.usage);
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
      await recordFailedProviderExecution("provider_parse_error", data.usage);
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
      await recordFailedProviderExecution("provider_incomplete", data.usage);
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
    if (!localOnlyAction) {
      await recordUsageExecution({ actionId, route: "/api/translate-article", provider: "deepseek", model, promptTokens: data.usage?.prompt_tokens, promptCacheHitTokens: data.usage?.prompt_cache_hit_tokens, promptCacheMissTokens: data.usage?.prompt_cache_miss_tokens, completionTokens: data.usage?.completion_tokens, estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, data.usage ?? {}), status: "succeeded" }).catch(() => undefined);
    }
    if (!managedTranslationAction) await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    await recordFailedProviderExecution(timedOut ? "provider_timeout" : "provider_connection_failed");
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
    if (!usageSucceeded && !managedTranslationAction) {
      await refundUsage(actionId, "failed", "translation_failed").catch(() => undefined);
    }
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
  }
}
