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

function fallbackSummary(article: string): string {
  const firstSentence = article
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)[0]
    ?.trim();
  return firstSentence ? `文章开头提到：${firstSentence.slice(0, 60)}` : "这是一篇已保存的英文阅读文章。";
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
    return NextResponse.json({ summary: fallbackSummary(article) });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

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
        max_tokens: 90,
        thinking: {
          type: "disabled",
        },
        messages: [
          {
            role: "system",
            content: "你是英文文章摘要助手。请只输出一句中文摘要，不要 Markdown，不要编号，不要解释。",
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
      return NextResponse.json({ summary: fallbackSummary(article), warning: data?.error?.message });
    }

    const summary = data?.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ summary: summary || fallbackSummary(article) });
  } catch {
    return NextResponse.json({ summary: fallbackSummary(article) });
  } finally {
    clearTimeout(timeoutId);
  }
}
