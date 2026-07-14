import { NextResponse } from "next/server";
import type { ExplanationRequest } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";

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

function parseSseContent(line: string): string {
  if (!line.startsWith("data:")) {
    return "";
  }

  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return "";
  }

  try {
    const parsed = JSON.parse(payload) as DeepSeekStreamChunk;
    return parsed.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  let body: unknown;

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
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const upstreamController = new AbortController();
  const abortFromClient = () => upstreamController.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => upstreamController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
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
        thinking: {
          type: "disabled",
        },
        messages: [
          {
            role: "system",
            content:
              "你是给中文母语英语学习者使用的流式语境解释助手。只输出可直接展示的纯文本，不要 JSON，不要 Markdown 表格，不要代码块。必须按固定行顺序输出，每个标题只出现一次，每项只能占一行：原型：、音标：、词性：、难度：、基础释义：、当前语境含义：、当前句子翻译：、用法说明：、常见搭配：、英文例句：、例句中文翻译：。目标是单词时，原型只能是该单词的一个原型，不能带相邻词；目标是多词短语时，原型留空，音标按“单词 /音标/ · 单词 /音标/”逐词列出。当前语境含义只能写目标词或短语在句中的中文对应含义，不能写整句翻译。目标是单个单词时，当前语境含义必须解释这个单词本身在句中的贡献，不能把相邻副词、否定词、程度词或搭配词的整体效果并入释义。例如目标是 intelligible 且原句含 barely intelligible 时，当前语境含义应写“可理解的；听得清的”，不要写“口齿不清的”；整体效果放在当前句子翻译或用法说明。目标是多词短语时，当前语境含义才解释整个短语。常见搭配给 2-4 个，每个英文搭配后必须紧跟简短中文释义，格式为“service fee（服务费）；legal fee（律师费）”。英文例句只能有一个英文句子；例句中文翻译只能有一条对应中文翻译，严禁混入常见搭配或第二条例句。词性统一使用中文，例如名词、动词、形容词、短语；难度只使用基础、进阶、高阶。中文字段必须使用中文。保持每项简洁。",
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
    });

    if (!response.ok || !response.body) {
      clearTimeout(timeoutId);
      request.signal.removeEventListener("abort", abortFromClient);
      releaseSlot();
      return NextResponse.json({ error: "DeepSeek 流式解释生成失败，请重新生成。" }, { status: 502 });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = "";

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
              const content = parseSseContent(line);
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            }
          }

          const tail = parseSseContent(buffer);
          if (tail) {
            controller.enqueue(encoder.encode(tail));
          }
          controller.close();
        } catch {
          controller.close();
        } finally {
          clearTimeout(timeoutId);
          request.signal.removeEventListener("abort", abortFromClient);
          releaseSlot();
          reader.releaseLock();
        }
      },
      cancel() {
        clearTimeout(timeoutId);
        request.signal.removeEventListener("abort", abortFromClient);
        releaseSlot();
        upstreamController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
    return NextResponse.json({ error: "DeepSeek 流式解释生成失败，请重新生成。" }, { status: 502 });
  }
}
