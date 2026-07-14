import { NextResponse } from "next/server";
import type { ArticleTranslationBlock, ArticleTranslationResult } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_BLOCKS = 80;
const MAX_BLOCK_CHARS = 900;
const MAX_TOTAL_CHARS = 16000;
const REQUEST_TIMEOUT_MS = 45000;

const TRANSLATION_SYSTEM_PROMPT =
  'You are a rigorous English-to-Chinese long-form contextual translation assistant. The input "target" is the set of article blocks that must be translated now, and "context" is the full current article context. Read the full context first, keep names, terms, pronouns, tense, and logical connections consistent, then translate only target. Preserve target order and ids. Do not omit information, add explanations, or output Markdown. Return strict JSON only: {"translations":[{"id":"original id","translation":"Chinese translation"}]}.';

export const maxDuration = 60;

interface DeepSeekTranslationResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface TranslationRequestBody {
  blocks?: ArticleTranslationBlock[];
  contextBlocks?: ArticleTranslationBlock[];
}

function isTranslationBlock(value: unknown): value is ArticleTranslationBlock {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ArticleTranslationBlock>;
  return typeof candidate.id === "string" && typeof candidate.type === "string" && typeof candidate.text === "string";
}

function sanitizeBlocks(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[] {
  let totalChars = 0;
  return blocks.slice(0, MAX_BLOCKS).map((block) => {
    const text = block.text.trim().slice(0, MAX_BLOCK_CHARS);
    totalChars += text.length;
    return {
      id: block.id,
      type: block.type,
      text,
    };
  }).filter((block) => {
    if (!block.text) {
      return false;
    }
    if (totalChars > MAX_TOTAL_CHARS) {
      totalChars -= block.text.length;
      return false;
    }
    return true;
  });
}

function parseJsonObject(raw: string): ArticleTranslationResult {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as Partial<ArticleTranslationResult>;
  const translations = Array.isArray(parsed.translations)
    ? parsed.translations
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const candidate = item as Partial<ArticleTranslationResult["translations"][number]>;
          return {
            id: String(candidate.id ?? ""),
            translation: String(candidate.translation ?? "").trim(),
          };
        })
        .filter((item) => item.id && item.translation)
    : [];

  return { translations };
}

function friendlyError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("insufficient balance") || normalized.includes("rate limit") || normalized.includes("overloaded")) {
    return "DeepSeek is busy, full-article translation was not generated. Please try again later.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("invalid api key")) {
    return "DeepSeek API key is invalid or lacks permission. Check .env.local.";
  }
  return "Full-article translation failed. Please try again later.";
}

export async function POST(request: Request) {
  let input: TranslationRequestBody;
  try {
    input = await readJsonBody<TranslationRequestBody>(request, 512 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "Request body is too large." : "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  if (!Array.isArray(input.blocks) || !input.blocks.every(isTranslationBlock)) {
    return NextResponse.json({ error: "Missing article blocks." }, { status: 400 });
  }

  const blocks = sanitizeBlocks(input.blocks);
  const contextBlocks =
    Array.isArray(input.contextBlocks) && input.contextBlocks.every(isTranslationBlock)
      ? sanitizeBlocks(input.contextBlocks)
      : blocks;

  if (!blocks.length) {
    return NextResponse.json({ error: "No translatable article text found." }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY is not configured." }, { status: 500 });
  }

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    return NextResponse.json({ error: "AI service is busy. Please try again shortly." }, { status: 503, headers: { "Retry-After": "3" } });
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_TRANSLATION_MODEL || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  request.signal.addEventListener("abort", abortFromClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 3600,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        messages: [
          {
            role: "system",
            content: TRANSLATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              target: blocks.map((block) => [block.id, block.type, block.text]),
              context: contextBlocks.map((block) => [block.id, block.type, block.text]),
            }),
          },
        ],
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as DeepSeekTranslationResponse;
    if (!response.ok) {
      const errorMessage = data.error?.message || response.statusText || "DeepSeek request failed.";
      return NextResponse.json({ error: friendlyError(errorMessage) }, { status: response.status });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "DeepSeek returned an empty translation." }, { status: 502 });
    }

    const result = parseJsonObject(content);
    if (!result.translations.length) {
      return NextResponse.json({ error: "DeepSeek returned no usable translations." }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "DeepSeek full-article translation timed out. Please try again later."
        : "Full-article translation failed. Check network or DeepSeek config.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
    releaseSlot();
  }
}
