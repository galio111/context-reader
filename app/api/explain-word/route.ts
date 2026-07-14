import { NextResponse } from "next/server";
import {
  DeepSeekParseError,
  MissingDeepSeekEnvError,
  explainWordWithDeepSeek,
  sanitizeExplanationRequest,
} from "@/lib/deepseek";
import type { ExplanationRequest } from "@/types/reader";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { acquireCostSlot } from "@/lib/costConcurrency";

export const maxDuration = 60;

const WORD_OR_PHRASE_PATTERN = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['-][A-Za-z]+)*){0,7}$/;

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

  const releaseSlot = acquireCostSlot("ai", 8);
  if (!releaseSlot) {
    return NextResponse.json({ error: "AI 服务当前请求较多，请稍后再试。" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  try {
    const safeRequest = sanitizeExplanationRequest(body);
    const explanation = await explainWordWithDeepSeek(safeRequest);
    return NextResponse.json({ explanation });
  } catch (error) {
    if (error instanceof MissingDeepSeekEnvError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof DeepSeekParseError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    console.error("DeepSeek request failed", error);
    return NextResponse.json({ error: "DeepSeek 请求失败，请稍后重试。" }, { status: 502 });
  } finally {
    releaseSlot();
  }
}
