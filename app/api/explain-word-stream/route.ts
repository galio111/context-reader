import { NextResponse } from "next/server";
import type { ExplanationRequest } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { EXPLANATION_STREAM_COMPLETE_MARKER } from "@/lib/explanationStreamProtocol";
import { classifyStreamTermination } from "@/lib/requestCancellation";
import { registerActiveLookupRequest } from "@/lib/activeLookupRequests";
import { coreDeepSeekModelCandidates, fetchWithDeepSeekModelFailover } from "@/lib/deepseekModelFailover";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 30000;
const WORD_OR_PHRASE_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['-][A-Za-z]+)*){0,7}$/;

export const maxDuration = 60;

interface DeepSeekStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: ProviderTokenUsage;
}

function trimField(value: string): string {
  return value.trim().slice(0, 500);
}

function sanitizeExplanationRequest(input: ExplanationRequest): ExplanationRequest {
  return {
    word: trimField(input.word),
    sentence: trimField(input.sentence),
    previousSentence: trimField(input.previousSentence ?? ""),
    nextSentence: trimField(input.nextSentence ?? ""),
  };
}

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

function parseSseContent(line: string, onUsage?: (usage: ProviderTokenUsage) => void): string {
  if (!line.startsWith("data:")) {
    return "";
  }

  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return "";
  }

  try {
    const parsed = JSON.parse(payload) as DeepSeekStreamChunk;
    if (parsed.usage) onUsage?.(parsed.usage);
    return parsed.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
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
      guestMetricKey: "guest_article_lookup",
      units: 1,
    });
    actionId = usage.actionId;
  } catch (error) {
    return usageErrorResponse(error) ?? NextResponse.json({ error: "用量校验失败。" }, { status: 500 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "缺少 DEEPSEEK_API_KEY，请先配置 .env.local。" }, { status: 500 });
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  const safeRequest = sanitizeExplanationRequest(body);
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL;
  const modelCandidates = coreDeepSeekModelCandidates(process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL);
  let activeModel = modelCandidates[0];
  const upstreamController = new AbortController();
  const explicitCancellationController = new AbortController();
  let clientAborted = false;
  let timedOut = false;
  const abortFromClient = () => {
    if (clientAborted || timedOut) return;
    clientAborted = true;
    upstreamController.abort();
  };
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener("abort", abortFromClient, { once: true });
  explicitCancellationController.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => {
    if (clientAborted || timedOut) return;
    timedOut = true;
    upstreamController.abort();
  }, REQUEST_TIMEOUT_MS);
  const unregisterLookup = registerActiveLookupRequest(actionId, explicitCancellationController);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
    explicitCancellationController.signal.removeEventListener("abort", abortFromClient);
    unregisterLookup();
    releaseSlot();
  };

  try {
    const provider = await fetchWithDeepSeekModelFailover({
      models: modelCandidates,
      attempt: (model) => fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 900,
          stream: true,
          stream_options: { include_usage: true },
          thinking: {
            type: "disabled",
          },
          messages: [
            {
              role: "system",
              content:
                "你是给中文母语英语学习者使用的流式语境解释助手。只输出可直接展示的纯文本，不要 JSON，不要 Markdown 表格，不要代码块。必须按固定行顺序输出，每个标题只出现一次，每项只能占一行：原型：、当前词音标：、当前词音标归属：、词性：、难度：、基础释义：、当前语境含义：、当前句子翻译：、用法说明：、常见搭配：、英文例句：、例句中文翻译：。目标是单词时，原型只能是该单词的一个原型，不能带相邻词；当前词音标必须描述用户实际选择的词形，绝不能改成原型的音标；当前词音标归属必须原样填写用户实际选择的词形。无法确认当前词形音标时，当前词音标和当前词音标归属都留空。目标是多词短语时，原型留空，当前词音标按“单词 /音标/ · 单词 /音标/”逐个描述实际选中的词形，当前词音标归属原样填写整个所选短语。当前语境含义只能写目标词或短语在句中的中文对应含义，不能写整句翻译。目标是单个单词时，当前语境含义必须解释这个单词本身在句中的贡献，不能把相邻副词、否定词、程度词或搭配词的整体效果并入释义。例如目标是 intelligible 且原句含 barely intelligible 时，当前语境含义应写“可理解的；听得清的”，不要写“口齿不清的”；整体效果放在当前句子翻译或用法说明。目标是多词短语时，当前语境含义才解释整个短语。常见搭配给 2-4 个，每个英文搭配后必须紧跟简短中文释义，格式为“service fee（服务费）；legal fee（律师费）”。英文例句只能有一个英文句子；例句中文翻译只能有一条对应中文翻译，严禁混入常见搭配或第二条例句。词性统一使用中文，例如名词、动词、形容词、短语；难度只使用基础、进阶、高阶。中文字段必须使用中文。保持每项简洁。",
            },
            {
              role: "user",
              content: JSON.stringify({
                w: safeRequest.word,
                s: safeRequest.sentence,
                p: safeRequest.previousSentence,
                n: safeRequest.nextSentence,
              }),
            },
          ],
        }),
        signal: upstreamController.signal,
      }),
      onFailover: ({ model, status }) => {
        console.warn("[deepseek-stream] Falling back after provider rejection", { model, status });
      },
    });
    const { response, model } = provider;
    activeModel = model;

    if (!response.ok || !response.body) {
      console.error("[deepseek-stream] Upstream rejected request", {
        status: response.status,
        model,
        baseURL,
      });
      release();
      return NextResponse.json({ error: "DeepSeek 流式解释生成失败，请重新生成。" }, { status: 502 });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        let providerUsage: ProviderTokenUsage = {};
        const captureUsage = (usage: ProviderTokenUsage) => { providerUsage = usage; };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const content = parseSseContent(line, captureUsage);
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            }
          }

          const tail = parseSseContent(buffer, captureUsage);
          if (tail) {
            controller.enqueue(encoder.encode(tail));
          }
          // Tell the reader that all display fields are available before slower
          // usage bookkeeping finishes and the HTTP response finally closes.
          controller.enqueue(encoder.encode(EXPLANATION_STREAM_COMPLETE_MARKER));
          await recordUsageExecution({
            actionId,
            route: "/api/explain-word-stream",
            provider: "deepseek",
            model,
            promptTokens: providerUsage.prompt_tokens,
            promptCacheHitTokens: providerUsage.prompt_cache_hit_tokens,
            promptCacheMissTokens: providerUsage.prompt_cache_miss_tokens,
            completionTokens: providerUsage.completion_tokens,
            estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, providerUsage),
            status: "succeeded",
          }).catch(() => undefined);
          await finishUsage(actionId, "succeeded").catch(() => undefined);
          controller.close();
        } catch (error) {
          const termination = classifyStreamTermination({ clientAborted, timedOut, error });
          if (termination === "cancelled") {
            await refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
            return;
          }
          controller.close();
        } finally {
          release();
          reader.releaseLock();
        }
      },
      cancel() {
        abortFromClient();
        if (clientAborted) {
          void refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
        }
        release();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    const termination = classifyStreamTermination({ clientAborted, timedOut, error });
    if (termination === "cancelled") {
      await refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
      release();
      return new Response(null, { status: 499 });
    }
    const cause = error && typeof error === "object" && "cause" in error
      ? (error as { cause?: { name?: unknown; code?: unknown; message?: unknown } }).cause
      : undefined;
    console.error("[deepseek-stream] Upstream request failed", {
      model: activeModel,
      baseURL,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : "",
      causeName: typeof cause?.name === "string" ? cause.name : "",
      causeCode: typeof cause?.code === "string" ? cause.code : "",
      causeMessage: typeof cause?.message === "string" ? cause.message.slice(0, 300) : "",
    });
    release();
    return NextResponse.json(
      { error: termination === "timeout" ? "DeepSeek 流式解释生成超时，请重新生成。" : "DeepSeek 流式解释生成失败，请重新生成。" },
      { status: termination === "timeout" ? 504 : 502 },
    );
  }
}
