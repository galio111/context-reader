import { NextResponse } from "next/server";
import {
  DeepSeekParseError,
  MissingDeepSeekEnvError,
  explainWordWithDeepSeek,
  sanitizeExplanationRequest,
} from "@/lib/deepseek";
import type { ExplanationRequest } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";

export const maxDuration = 60;

const WORD_OR_PHRASE_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['-][A-Za-z]+)*){0,7}$/;

function isValidRequestBody(body: unknown): body is ExplanationRequest {
  const input = body as Partial<ExplanationRequest>;
  return (
    typeof input?.word === "string" &&
    typeof input.sentence === "string" &&
    typeof input.previousSentence === "string" &&
    typeof input.nextSentence === "string" &&
    WORD_OR_PHRASE_PATTERN.test(input.word.trim())
  );
}

export async function POST(request: Request) {
  let body: unknown;
  let actionId = "";

  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
    }
    return NextResponse.json({ error: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  if (!isValidRequestBody(body)) {
    return NextResponse.json(
      { error: "请求缺少 word、sentence、previousSentence 或 nextSentence，或 word 格式不正确。" },
      { status: 400 },
    );
  }

  try {
    const usage = await gateUsage(request, {
      feature: "word_explanation",
      metricKey: "lookup_generation",
      units: 1,
    });
    actionId = usage.actionId;
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "用量校验失败。" }, { status: 500 });
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "service",
      severity: "warning",
      operation: "context_word_explanation",
      endpoint: "/api/explain-word",
      userMessage: "解释服务当前请求较多，请稍后重试。",
      technicalMessage: "Local AI concurrency limit reached.",
      code: "local_concurrency",
      httpStatus: 503,
    });
    return NextResponse.json(
      { error: "解释服务当前请求较多，请稍后重试。", code: "local_concurrency", ...reportReference(report) },
      { status: 503, headers: { "Retry-After": "3" } },
    );
  }

  try {
    const safeRequest = sanitizeExplanationRequest(body);
    const result = await explainWordWithDeepSeek(safeRequest);
    await recordUsageExecution({
      actionId,
      route: "/api/explain-word",
      provider: result.provider,
      model: result.model,
      promptTokens: result.usage.prompt_tokens,
      promptCacheHitTokens: result.usage.prompt_cache_hit_tokens,
      promptCacheMissTokens: result.usage.prompt_cache_miss_tokens,
      completionTokens: result.usage.completion_tokens,
      estimatedCostMicrousd: estimateDeepSeekCostMicrousd(result.model, result.usage),
      status: "succeeded",
    }).catch(() => undefined);
    await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json({ explanation: result.explanation });
  } catch (error) {
    await refundUsage(actionId, "failed", error instanceof Error ? error.name : "unknown").catch(() => undefined);
    if (error instanceof MissingDeepSeekEnvError) {
      const report = await recordServerError(request, {
        category: "configuration",
        severity: "critical",
        operation: "context_word_explanation",
        endpoint: "/api/explain-word",
        userMessage: "解释服务暂时不可用，开发者已收到异常并正在处理。",
        code: "missing_provider_configuration",
        httpStatus: 500,
      }, error);
      return NextResponse.json(
        { error: "解释服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
        { status: 500 },
      );
    }

    if (error instanceof DeepSeekParseError) {
      const report = await recordServerError(request, {
        category: "provider",
        operation: "context_word_explanation",
        endpoint: "/api/explain-word",
        userMessage: "解释结果格式异常，开发者已收到问题并正在处理。",
        code: "provider_parse_error",
        httpStatus: 502,
      }, error);
      return NextResponse.json(
        { error: "解释结果格式异常，开发者已收到问题并正在处理。", ...reportReference(report) },
        { status: 502 },
      );
    }

    console.error("DeepSeek request failed", error);
    const report = await recordServerError(request, {
      category: "provider",
      operation: "context_word_explanation",
      endpoint: "/api/explain-word",
      userMessage: "解释服务暂时不可用，开发者已收到异常并正在处理。",
      code: "provider_request_failed",
      httpStatus: 502,
    }, error);
    return NextResponse.json(
      { error: "解释服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 502 },
    );
  } finally {
    releaseSlot();
  }
}
