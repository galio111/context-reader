import { NextResponse } from "next/server";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { sanitizeDictionaryQuery } from "@/lib/deepseekDictionary";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";

export const maxDuration = 60;

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 35_000;
const QUERY_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,7}$/;

interface DeepSeekStreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: ProviderTokenUsage;
}

function parseSseContent(line: string, onUsage: (usage: ProviderTokenUsage) => void): string {
  if (!line.startsWith("data:")) return "";
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const parsed = JSON.parse(payload) as DeepSeekStreamChunk;
    if (parsed.usage) onUsage(parsed.usage);
    return parsed.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  let body: unknown;
  let actionId = "";
  try {
    body = await readJsonBody(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "查询内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const query = sanitizeDictionaryQuery(
    body && typeof body === "object" && "query" in body
      ? String((body as { query?: unknown }).query ?? "")
      : "",
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

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    await refundUsage(actionId, "failed", "missing_api_key").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "configuration",
      severity: "critical",
      operation: "standalone_dictionary_lookup",
      endpoint: "/api/dictionary-stream",
      userMessage: "词典服务暂时不可用，开发者已收到异常并正在处理。",
      technicalMessage: "DEEPSEEK_API_KEY is missing.",
      code: "missing_api_key",
      httpStatus: 500,
    });
    return NextResponse.json(
      { error: "词典服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 500 },
    );
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    await refundUsage(actionId, "failed", "local_concurrency").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "service",
      severity: "warning",
      operation: "standalone_dictionary_lookup",
      endpoint: "/api/dictionary-stream",
      userMessage: "词典服务当前请求较多，请稍后重试。",
      technicalMessage: "Local AI concurrency limit reached.",
      code: "local_concurrency",
      httpStatus: 503,
    });
    return NextResponse.json(
      { error: "词典服务当前请求较多，请稍后重试。", code: "local_concurrency", ...reportReference(report) },
      { status: 503, headers: { "Retry-After": "3" } },
    );
  }

  const baseURL = (process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  const upstreamController = new AbortController();
  const abortFromClient = () => upstreamController.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => upstreamController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1_500,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content: `你是给中文母语英语学习者使用的独立深度英汉词典。只输出 NDJSON，每行一个独立、完整、紧凑的 JSON 对象；不要 Markdown、代码块、数组、总对象或额外文字。必须严格按以下顺序逐行输出，让客户端每收到一行就能渲染一个最终界面区块：
1. 一行词头：{"type":"head","query":"用户输入","lemma":"原形","phonetic":"IPA"}
2. 1-4 行常用义项：{"type":"sense","partOfSpeech":"英文词性","meaning":"准确中文释义","register":"常用/正式/口语/学术","exampleEnglish":"自然英文例句","exampleChinese":"对应中文"}
3. 一行用法：{"type":"usage","value":"核心用法、语气、句型和易混点"}
4. 3-6 行搭配：{"type":"collocation","phrase":"英文搭配","meaning":"中文","exampleEnglish":"简短英文例句"}
5. 0-5 行词族：{"type":"wordFamily","word":"词","partOfSpeech":"英文词性","meaning":"中文"}
6. 0-5 行近义词：{"type":"synonym","word":"词","difference":"中文差别"}
7. 0-4 行易错点：{"type":"mistake","value":"中文说明"}
8. 一行记忆提示：{"type":"memory","value":"可信提示，不编造词源"}
9. 最后一行：{"type":"done"}
短语的 phonetic 按“word /音标/ · word /音标/”逐词给出。每个 JSON 对象必须单独占一行并在该行一次闭合，不能把同一对象拆成多行。所有解释字段使用自然、准确的中文，内容要紧凑但把词查透。`,
          },
          { role: "user", content: JSON.stringify({ query }) },
        ],
      }),
      signal: upstreamController.signal,
    });

    if (!response.ok || !response.body) {
      const upstreamDetail = !response.ok ? await response.text().catch(() => "") : "";
      clearTimeout(timeoutId);
      request.signal.removeEventListener("abort", abortFromClient);
      releaseSlot();
      await refundUsage(actionId, "failed", "upstream_rejected").catch(() => undefined);
      const report = await recordServerError(request, {
        category: "provider",
        operation: "standalone_dictionary_lookup",
        endpoint: "/api/dictionary-stream",
        userMessage: "词典服务暂时不可用，开发者已收到异常并正在处理。",
        technicalMessage: `DeepSeek rejected dictionary stream: HTTP ${response.status}. ${upstreamDetail.slice(0, 2_000)}`,
        code: "upstream_rejected",
        httpStatus: 502,
        metadata: { providerStatus: response.status, model },
      });
      return NextResponse.json(
        { error: "词典服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
        { status: 502 },
      );
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timeoutId);
      request.signal.removeEventListener("abort", abortFromClient);
      releaseSlot();
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";
        let providerUsage: ProviderTokenUsage = {};
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const content = parseSseContent(line, (usage) => { providerUsage = usage; });
              if (content) controller.enqueue(encoder.encode(content));
            }
          }
          const tail = parseSseContent(buffer, (usage) => { providerUsage = usage; });
          if (tail) controller.enqueue(encoder.encode(tail));
          await recordUsageExecution({
            actionId,
            route: "/api/dictionary-stream",
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
          await refundUsage(actionId, "failed", "stream_failed").catch(() => undefined);
          await recordServerError(request, {
            category: "provider",
            operation: "standalone_dictionary_stream",
            endpoint: "/api/dictionary-stream",
            userMessage: "词典结果生成中断，开发者已收到异常并正在处理。",
            code: "stream_failed",
            httpStatus: 502,
            metadata: { model },
          }, error);
          controller.close();
        } finally {
          release();
          reader.releaseLock();
        }
      },
      cancel() {
        upstreamController.abort();
        void refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
        release();
      },
    });

    return new Response(stream, {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    releaseSlot();
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
    await refundUsage(actionId, "failed", "upstream_failed").catch(() => undefined);
    const report = await recordServerError(request, {
      category: "provider",
      operation: "standalone_dictionary_lookup",
      endpoint: "/api/dictionary-stream",
      userMessage: "词典服务暂时不可用，开发者已收到异常并正在处理。",
      code: "upstream_failed",
      httpStatus: 502,
      metadata: { model },
    }, error);
    return NextResponse.json(
      { error: "词典服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 502 },
    );
  }
}
