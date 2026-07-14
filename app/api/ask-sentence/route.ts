import { NextResponse } from "next/server";
import { DeepSeekParseError, MissingDeepSeekEnvError, sanitizeSentenceQuestionRequest } from "@/lib/deepseek";
import { answerSentenceQuestionWithDeepSeek } from "@/lib/sentenceQuestion";
import type { SentenceQuestionRequest } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd } from "@/lib/usageCost";

export const maxDuration = 60;

const WORD_OR_PHRASE_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['-][A-Za-z]+)*){0,7}$/;

function isValidRequestBody(body: unknown): body is SentenceQuestionRequest {
  const input = body as Partial<SentenceQuestionRequest>;
  return (
    typeof input?.word === "string" &&
    typeof input.sentence === "string" &&
    typeof input.previousSentence === "string" &&
    typeof input.nextSentence === "string" &&
    typeof input.question === "string" &&
    input.question.trim().length > 0 &&
    WORD_OR_PHRASE_PATTERN.test(input.word.trim())
  );
}

export async function POST(request: Request) {
  let body: unknown;
  let actionId = "";

  try {
    body = await readJsonBody(request, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
    }
    return NextResponse.json({ error: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  if (!isValidRequestBody(body)) {
    return NextResponse.json(
      { error: "请求缺少当前划词、所在句、上下文或问题内容。" },
      { status: 400 },
    );
  }

  try {
    actionId = (await gateUsage(request, {
      feature: "sentence_question",
      metricKey: "lookup_generation",
      units: 1,
      loginRequired: true,
    })).actionId;
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "用量校验失败。" }, { status: 500 });
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  try {
    const safeRequest = sanitizeSentenceQuestionRequest(body);
    const result = await answerSentenceQuestionWithDeepSeek(safeRequest);
    await recordUsageExecution({ actionId, route: "/api/ask-sentence", provider: result.provider, model: result.model, promptTokens: result.usage.prompt_tokens, promptCacheHitTokens: result.usage.prompt_cache_hit_tokens, promptCacheMissTokens: result.usage.prompt_cache_miss_tokens, completionTokens: result.usage.completion_tokens, estimatedCostMicrousd: estimateDeepSeekCostMicrousd(result.model, result.usage), status: "succeeded" }).catch(() => undefined);
    await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json({ answer: result.answer });
  } catch (error) {
    await refundUsage(actionId, "failed", error instanceof Error ? error.name : "unknown").catch(() => undefined);
    if (error instanceof MissingDeepSeekEnvError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof DeepSeekParseError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    console.error("Sentence question request failed", error);
    return NextResponse.json({ error: "DeepSeek 请求失败，请稍后重试。" }, { status: 502 });
  } finally {
    releaseSlot();
  }
}
