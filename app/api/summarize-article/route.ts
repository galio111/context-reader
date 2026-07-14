import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";

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
  let body: { article?: unknown } | null;
  try {
    body = await readJsonBody(request, 128 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求体必须是合法 JSON。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const article = typeof body?.article === "string" ? body.article.trim() : "";

  if (!article) {
    return NextResponse.json({ error: "缺少文章内容，无法生成摘要。" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    return NextResponse.json({ error: "缺少 DeepSeek API Key，无法生成文章中文摘要。" }, { status: 500 });
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      return NextResponse.json(
        { error: userFriendlyDeepSeekError(data?.error?.message) },
        { status: response.status },
      );
    }

    const summary = cleanSummary(data?.choices?.[0]?.message?.content ?? "");
    if (!summary || !hasEnoughChineseContent(summary)) {
      return NextResponse.json(
        { error: "DeepSeek 返回的文章摘要内容无效，请重新保存。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "生成文章摘要超时，请稍后重试。"
      : "生成文章摘要失败，请检查网络和 DeepSeek 配置。";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
  }
}
