import { NextResponse } from "next/server";
import { finishUsage, recordUsageExecution, refundUsage } from "@/lib/accountStore";
import { acquireCostSlot } from "@/lib/costConcurrency";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { isValidStandaloneDictionaryQuery, sanitizeDictionaryQuery } from "@/lib/deepseekDictionary";
import { normalizeDictionaryStreamLine } from "@/lib/dictionaryStreamServer";
import { gateUsage, usageErrorResponse } from "@/lib/usageGate";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";
import { classifyStreamTermination } from "@/lib/requestCancellation";

export const maxDuration = 60;

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 35_000;
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
  if (!query || !isValidStandaloneDictionaryQuery(query)) {
    return NextResponse.json({ error: "请输入中文词语，或不超过 8 个词的英文短语。" }, { status: 400 });
  }

  try {
    const usage = await gateUsage(request, {
      feature: "standalone_dictionary",
      metricKey: "lookup_generation",
      guestMetricKey: "guest_dictionary_lookup",
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
  let clientAborted = false;
  let timedOut = false;
  const abortFromClient = () => {
    if (clientAborted || timedOut) return;
    clientAborted = true;
    upstreamController.abort();
  };
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => {
    if (clientAborted || timedOut) return;
    timedOut = true;
    upstreamController.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2_400,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content: `你是给中文母语英语学习者使用的双向深度英汉词典。只输出 NDJSON，每行一个独立、完整、紧凑的 JSON 对象；不要 Markdown、代码块、数组、总对象或额外文字。必须严格按以下顺序逐行输出，让客户端每收到一行就能渲染一个最终界面区块：
1. 英文输入使用 direction="en_to_cn"；中文输入使用 direction="cn_to_en"。query 必须保留用户原输入。输出一行词头：{"type":"head","query":"用户输入","lemma":"英文原形或中译英第一候选","phonetic":"英文输入当前词形或中译英第一候选的 IPA","phoneticFor":"该音标实际描述的英文，英译中必须原样等于 query，中译英等于第一候选","direction":"en_to_cn 或 cn_to_en","inputStatus":"valid、inflection、ambiguous 或 misspelled","suggestedQuery":"仅英文拼错时填写"}
2. 英译中：真实表达用 valid，正常词形变化用 inflection。同一拼写如果既是某词的词形变化、又是另一个独立词头，必须用 ambiguous，并同时返回两组常用义项。例如 fell 必须同时显示 fall 的过去式义项，以及独立动词 fell（砍倒）和名词 fell（摔倒等）义项，不能只选其中一种。明显拼错用 misspelled；拼错时不得编造词义、音标或例句，词头后立刻输出 done。继续输出 1-8 行中文义项：{"type":"sense","headword":"该义项所属词头","headwordNote":"词形关系或独立词头说明","partOfSpeech":"英文词性","meaning":"准确中文释义","phonetic":"","register":"中文语域说明","usageNote":"","exampleEnglish":"自然英文例句","exampleChinese":"对应中文"}。同一 headword 的义项必须连续排列；每个常用义项必须有自然的英中例句，不能为了缩短输出而删减例句。
3. 中译英：中文 query 始终是页面词头，inputStatus 固定为 valid。按实际需要输出 1-4 个自然英文候选，不得默认只有一个，也不得为凑数量返回生硬表达。若中文可表示多种词性（例如“绑架”既可作动词也可作名词），必须先按词性分类，同一词性的候选连续输出，再输出下一词性。每个候选单独一行：{"type":"sense","partOfSpeech":"准确英文词性","meaning":"英文候选表达","phonetic":"该候选的 IPA","register":"常用、正式、口语等中文语域说明","usageNote":"一两句中文说明适用场景","exampleEnglish":"自然英文例句","exampleChinese":"对应中文"}
例如输入 consiiider 时，第一行必须把 query 保留为 consiiider、lemma 和 suggestedQuery 写为 consider、inputStatus 写为 misspelled，第二行直接 done。
4. 必须先输出完全部 sense 行。仅英译中：若词头或其常用义项可作动词，随后输出一行变形：{"type":"verbForms","pastTense":"过去式","pastParticiple":"过去分词","presentParticiple":"现在分词"}。规则变化也必须完整填写；不是动词则跳过。中译英不得输出此行。
5. 输出一行用法。英译中写核心用法、句型、语气和易混点，必须具体；中译英只简短比较候选之间怎么选：{"type":"usage","value":"中文说明"}
6. 仅英译中继续输出完整学习板块，字段名必须严格照抄，禁止改成通用 value：
- 3-6 行真正高频的搭配：{"type":"collocation","phrase":"英文搭配","meaning":"中文含义","exampleEnglish":"自然英文例句"}
- 有合理派生词时输出 2-5 行词族：{"type":"wordFamily","word":"派生词","partOfSpeech":"英文词性","meaning":"中文含义"}
- 输出 2-5 行常见近义词：{"type":"synonym","word":"近义词","difference":"与词头在语气、语域或使用场景上的中文辨析"}
- 一行可信且不牵强的记忆提示：{"type":"memory","value":"中文提示"}
除非客观上不存在合理内容，否则不得省略这些板块。中译英跳过这些区块。
7. 两个方向都可输出 0-3 行真正有帮助的易错点：{"type":"mistake","value":"中文说明"}
8. 最后一行：{"type":"done"}
英文输入的 phonetic 必须描述用户实际输入的 query，绝不能改成 lemma（原型）的音标；无法确认当前词形的音标时，phonetic 和 phoneticFor 都留空。短语的 phonetic 按“word /音标/ · word /音标/”逐个描述实际输入的词形。每个 JSON 对象必须单独占一行并在该行一次闭合，不能把同一对象拆成多行。所有说明字段使用自然、准确的中文。`,
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
        let modelLineBuffer = "";
        let providerUsage: ProviderTokenUsage = {};
        const enqueueModelContent = (content: string, flush = false) => {
          modelLineBuffer += content;
          const lines = modelLineBuffer.split(/\r?\n/);
          if (flush) {
            modelLineBuffer = "";
          } else {
            modelLineBuffer = lines.pop() ?? "";
          }
          for (const line of lines) {
            const normalized = normalizeDictionaryStreamLine(line, query);
            if (normalized) controller.enqueue(encoder.encode(`${normalized}\n`));
          }
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const content = parseSseContent(line, (usage) => { providerUsage = usage; });
              if (content) enqueueModelContent(content);
            }
          }
          const tail = parseSseContent(buffer, (usage) => { providerUsage = usage; });
          if (tail) enqueueModelContent(tail);
          enqueueModelContent("", true);
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
          const termination = classifyStreamTermination({ clientAborted, timedOut, error });
          if (termination === "cancelled") {
            await refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
            return;
          }
          const code = termination === "timeout" ? "provider_timeout" : "stream_failed";
          await refundUsage(actionId, "failed", code).catch(() => undefined);
          await recordServerError(request, {
            category: "provider",
            operation: "standalone_dictionary_stream",
            endpoint: "/api/dictionary-stream",
            userMessage: termination === "timeout"
              ? "词典生成超时，请稍后重试。"
              : "词典结果生成中断，开发者已收到异常并正在处理。",
            code,
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
        clientAborted = true;
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
    const termination = classifyStreamTermination({ clientAborted, timedOut, error });
    if (termination === "cancelled") {
      await refundUsage(actionId, "cancelled", "client_cancelled").catch(() => undefined);
      return new Response(null, { status: 499 });
    }
    const code = termination === "timeout" ? "provider_timeout" : "upstream_failed";
    await refundUsage(actionId, "failed", code).catch(() => undefined);
    const report = await recordServerError(request, {
      category: "provider",
      operation: "standalone_dictionary_lookup",
      endpoint: "/api/dictionary-stream",
      userMessage: termination === "timeout"
        ? "词典查询超时，请稍后重试。"
        : "词典服务暂时不可用，开发者已收到异常并正在处理。",
      code,
      httpStatus: 502,
      metadata: { model },
    }, error);
    return NextResponse.json(
      { error: "词典服务暂时不可用，开发者已收到异常并正在处理。", ...reportReference(report) },
      { status: 502 },
    );
  }
}
