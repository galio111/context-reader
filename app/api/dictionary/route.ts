import { NextResponse } from "next/server";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { DeepSeekParseError, MissingDeepSeekEnvError } from "@/lib/deepseek";
import { lookupDictionaryWithDeepSeek, sanitizeDictionaryQuery } from "@/lib/deepseekDictionary";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd } from "@/lib/usageCost";

export const maxDuration = 60;

const QUERY_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,7}$/;

export async function POST(request: Request) {
  let body: unknown;
  let actionId = "";
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "查询内容过大。" }, { status: 413 });
    }
    return NextResponse.json({ error: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const query = sanitizeDictionaryQuery(
    body && typeof body === "object" && "query" in body ? String((body as { query?: unknown }).query ?? "") : "",
  );
  if (!query || !QUERY_PATTERN.test(query)) {
    return NextResponse.json({ error: "请输入一个英文单词，或不超过 8 个词的英文短语。" }, { status: 400 });
  }

  try {
    const usage = await gateUsage(request, {
      feature: "standalone_dictionary",
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
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503 });
  }

  try {
    const result = await lookupDictionaryWithDeepSeek(query);
    await recordUsageExecution({
      actionId,
      route: "/api/dictionary",
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
    return NextResponse.json({ dictionary: result.dictionary });
  } catch (error) {
    await refundUsage(actionId, "failed", error instanceof Error ? error.name : "unknown").catch(() => undefined);
    if (error instanceof MissingDeepSeekEnvError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof DeepSeekParseError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Dictionary lookup failed", error);
    return NextResponse.json({ error: "词典查询失败，请稍后重试。" }, { status: 502 });
  } finally {
    releaseSlot();
  }
}
