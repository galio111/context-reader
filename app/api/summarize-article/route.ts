import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { finishUsage, recordUsageExecution, refundUsage, setUsageActionMetadata } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";
import { getPublicArticle } from "@/lib/publicArticles";

const DEFAULT_MODEL = "deepseek-v4-pro";
const MAX_ARTICLE_CHARS = 6000;
const MIN_SUMMARY_CHINESE_CHARS = 8;
const MAX_SUMMARY_CHARS = 32;
const REQUEST_TIMEOUT_MS = 30000;

export const maxDuration = 60;

interface DeepSeekSummaryResponse {
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

function trimSummaryLength(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_SUMMARY_CHARS).replace(/[，,；;：:、]$/, "")}。`;
}

function cleanSummary(value: string): string {
  const summary = value
    .replace(/[`*_#>~-]/g, "")
    .replace(/^[\s"'“”‘’「」【】（）：:，,。.!！？?、；;\-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？!?]*$/, "。");

  return trimSummaryLength(summary);
}

function hasEnoughChineseContent(value: string): boolean {
  const chineseChars = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return chineseChars >= MIN_SUMMARY_CHINESE_CHARS;
}

function userFriendlyDeepSeekError(message = ""): string {
  if (/service is too busy|temporarily switch|busy/i.test(message)) {
    return "DeepSeek 当前服务繁忙，文章摘要没有生成成功，请稍后重新保存。";
  }
  return message || "DeepSeek 生成文章摘要失败。";
}

export async function POST(request: Request) {
  let actionId = "";
  let usageSucceeded = false;
  let body: { article?: unknown; publicArticleId?: unknown } | null;
  try {
    body = await readJsonBody(request, 128 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const article = typeof body?.article === "string" ? body.article.trim() : "";
  const publicArticleId = typeof body?.publicArticleId === "string" ? body.publicArticleId.trim() : "";

  if (!article) {
    return NextResponse.json({ error: "缺少文章内容，无法生成摘要。" }, { status: 400 });
  }


  try {
    actionId = (await gateUsage(request, {
      feature: "article_summary",
      metricKey: "article_summary",
      units: 1,
      loginRequired: true,
    })).actionId;
    await setUsageActionMetadata(actionId, {
      source: publicArticleId ? "public_cache_candidate" : "generated",
      articleKey: createHash("sha256").update(article).digest("hex").slice(0, 16),
      articleLabel: `用户文章 · ${createHash("sha256").update(article).digest("hex").slice(0, 6)}`,
      articleCharacters: article.length,
    }).catch(() => undefined);
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "用量校验失败。" }, { status: 500 });
  }

  if (publicArticleId) {
    const publicArticle = await getPublicArticle(publicArticleId).catch(() => null);
    const summary = publicArticle?.summary?.trim() ?? "";
    if (publicArticle?.body.trim() === article && hasEnoughChineseContent(summary)) {
      await setUsageActionMetadata(actionId, {
        source: "public_cache",
        publicArticleId,
        articleKey: createHash("sha256").update(article).digest("hex").slice(0, 16),
        articleLabel: publicArticle.title.slice(0, 120),
        articleCharacters: article.length,
      }).catch(() => undefined);
      // This is intentionally a charged cache hit: the user receives the plan
      // feature, while the site avoids a duplicate DeepSeek request.
      await finishUsage(actionId, "cached", true, false).catch(() => undefined);
      return NextResponse.json({ summary, cacheHit: true, source: "public_article" });
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    await refundUsage(actionId, "failed", "missing_api_key").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "configuration",
      severity: "critical",
      operation: "article_summary",
      endpoint: "/api/summarize-article",
      userMessage: "文章摘要服务暂时不可用，开发者已收到异常并正在处理。",
      technicalMessage: "DEEPSEEK_API_KEY is missing.",
      code: "missing_api_key",
      httpStatus: 500,
    });
    return NextResponse.json(
      { error: "文章摘要服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 500 },
    );
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const recordFailedProviderExecution = async (errorCode: string, usage: ProviderTokenUsage = {}) => {
    await recordUsageExecution({
      actionId,
      route: "/api/summarize-article",
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

  try {
    const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 80,
        thinking: {
          type: "disabled",
        },
        messages: [
          {
            role: "system",
            content:
              "你是英文阅读文章摘要助手。请根据用户提供的英文文章，输出一句中文短摘要，作为文章列表里的简介。摘要必须具体，控制在 15 到 28 个中文字符之间。只输出中文一句话，不要出现英文原文，不要 Markdown，不要编号，不要解释，不要只输出标点。",
          },
          {
            role: "user",
            content: article.slice(0, MAX_ARTICLE_CHARS),
          },
        ],
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as DeepSeekSummaryResponse | null;
    if (!response.ok) {
      const providerMessage = data?.error?.message || response.statusText;
      await recordFailedProviderExecution("provider_rejected", data?.usage);
      const report = await recordServerError(request, {
        category: "provider",
        operation: "article_summary",
        endpoint: "/api/summarize-article",
        userMessage: userFriendlyDeepSeekError(providerMessage),
        technicalMessage: `DeepSeek summary rejected: HTTP ${response.status}. ${providerMessage}`,
        code: "provider_rejected",
        httpStatus: response.status >= 500 ? response.status : 502,
        metadata: { providerStatus: response.status, model },
      });
      return NextResponse.json(
        { error: userFriendlyDeepSeekError(providerMessage), ...reportReference(report) },
        { status: response.status >= 500 ? response.status : 502 },
      );
    }

    const summary = cleanSummary(data?.choices?.[0]?.message?.content ?? "");
    if (!summary || !hasEnoughChineseContent(summary)) {
      await recordFailedProviderExecution("provider_invalid_content", data?.usage);
      const report = await recordServerError(request, {
        category: "provider",
        operation: "article_summary",
        endpoint: "/api/summarize-article",
        userMessage: "文章摘要结果格式异常，开发者已收到问题并正在处理。",
        technicalMessage: `Invalid summary content: ${JSON.stringify(summary)}`,
        code: "provider_invalid_content",
        httpStatus: 502,
        metadata: { model },
      });
      return NextResponse.json(
        { error: "文章摘要结果格式异常，开发者已收到问题并正在处理。", ...reportReference(report) },
        { status: 502 },
      );
    }

    usageSucceeded = true;
    await recordUsageExecution({ actionId, route: "/api/summarize-article", provider: "deepseek", model, promptTokens: data?.usage?.prompt_tokens, promptCacheHitTokens: data?.usage?.prompt_cache_hit_tokens, promptCacheMissTokens: data?.usage?.prompt_cache_miss_tokens, completionTokens: data?.usage?.completion_tokens, estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, data?.usage ?? {}), status: "succeeded" }).catch(() => undefined);
    await finishUsage(actionId, "succeeded").catch(() => undefined);
    return NextResponse.json({ summary });
  } catch (error) {
    await recordFailedProviderExecution(error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_request_failed");
    const message = error instanceof Error && error.name === "AbortError"
      ? "生成文章摘要超时，请稍后重试。"
      : "生成文章摘要失败，请检查网络和 DeepSeek 配置。";
    const report = await recordServerError(request, {
      category: "provider",
      operation: "article_summary",
      endpoint: "/api/summarize-article",
      userMessage: "文章摘要服务暂时不可用，开发者已收到异常并正在处理。",
      code: error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_request_failed",
      httpStatus: 502,
      metadata: { model },
    }, error);
    return NextResponse.json({ error: message, ...reportReference(report) }, { status: 502 });
  } finally {
    if (!usageSucceeded) {
      await refundUsage(actionId, "failed", "summary_failed").catch(() => undefined);
    }
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
  }
}
