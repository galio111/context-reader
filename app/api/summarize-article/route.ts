import { NextResponse } from "next/server";

const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_ARTICLE_CHARS = 6000;

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

function cleanSummary(value: string): string {
  return value
    .replace(/[`*_#>~-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？!?]*$/, "。");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { article?: unknown } | null;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

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
        max_tokens: 120,
        thinking: {
          type: "disabled",
        },
        messages: [
          {
            role: "system",
            content:
              "你是英文阅读文章摘要助手。请根据用户提供的英文文章，输出一句中文内容摘要，作为文章列表里的标题式简介。只输出中文一句话，不要出现英文原文，不要 Markdown，不要编号，不要解释。",
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
        { error: data?.error?.message || "DeepSeek 生成文章摘要失败。" },
        { status: response.status },
      );
    }

    const summary = cleanSummary(data?.choices?.[0]?.message?.content ?? "");
    if (!summary) {
      return NextResponse.json({ error: "DeepSeek 没有返回文章摘要。" }, { status: 502 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "生成文章摘要超时，请稍后重试。"
      : "生成文章摘要失败，请检查网络和 DeepSeek 配置。";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
