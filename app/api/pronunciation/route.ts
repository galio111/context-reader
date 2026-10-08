import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import {
  isPronunciationAccent,
  isValidPronunciationText,
  normalizePronunciationText,
} from "@/lib/pronunciation";
import {
  getPronunciationAudio,
  MissingPronunciationConfigurationError,
  PronunciationProviderError,
} from "@/lib/pronunciationServer";
import { recordServerError, reportReference } from "@/lib/serverErrorReporting";

import { normalizePronunciationPhonetic, pronunciationSynthesisInput } from "@/lib/pronunciationSsml";
import { requiresCurrentFormPhonetic } from "@/lib/pronunciation";

export const maxDuration = 30;

interface PronunciationRequestBody {
  text?: unknown;
  accent?: unknown;
  phonetic?: unknown;
}

export async function POST(request: Request) {
  let body: PronunciationRequestBody;
  try {
    body = await readJsonBody<PronunciationRequestBody>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "发音文本过长。" }, { status: 413 });
    }
    return NextResponse.json({ error: "请求体必须是合法 JSON。" }, { status: 400 });
  }

  const text = typeof body.text === "string"
    ? normalizePronunciationText(body.text)
    : "";
  if (!isPronunciationAccent(body.accent) || !isValidPronunciationText(text)) {
    return NextResponse.json(
      {
        error: "当前只支持一个英文单词或最多八个词的英文短语发音。",
        code: "unsupported_pronunciation_input",
      },
      { status: 400 },
    );
  }

  const phonetic = typeof body.phonetic === "string" ? normalizePronunciationPhonetic(body.phonetic, body.accent) : "";
  if (body.phonetic !== undefined && (!phonetic || !requiresCurrentFormPhonetic(text)
    || pronunciationSynthesisInput(text, phonetic, body.accent).textType !== "ssml")) {
    return NextResponse.json({ error: "当前音标无法用于单词发音。", code: "unsupported_pronunciation_phonetic" }, { status: 400 });
  }
  try {
    const result = await getPronunciationAudio(text, body.accent, phonetic);
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(result.bytes.byteLength),
        "Content-Disposition": `inline; filename="${result.filename}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Pronunciation-Filename": result.filename,
        "X-Pronunciation-Cache": result.cacheStatus,
        "X-Pronunciation-Voice": result.voice,
      },
    });
  } catch (error) {
    if (error instanceof MissingPronunciationConfigurationError) {
      return NextResponse.json(
        {
          error: "云端发音尚未完成配置。",
          code: "pronunciation_not_configured",
        },
        { status: 503 },
      );
    }

    const providerError = error instanceof PronunciationProviderError ? error : null;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const status = timedOut ? 504 : providerError?.status === 429 ? 429 : 502;
    const code = timedOut ? "provider_tts_timeout" : providerError?.status === 429 ? "provider_rate_limit" : "provider_tts_failed";
    const report = await recordServerError(request, {
      category: "provider",
      severity: "warning",
      operation: "pronunciation_tts",
      endpoint: "/api/pronunciation",
      userMessage: phonetic ? "云端发音暂时不可用，请稍后重试。" : "云端发音暂时不可用，已尝试使用当前设备的本地语音。",
      technicalMessage: error instanceof Error ? error.message : "Unknown pronunciation provider failure.",
      code,
      httpStatus: status,
      metadata: {
        accent: body.accent,
        providerCode: providerError?.providerCode || 0,
        providerAttempts: (error as { providerAttempts?: number } | null)?.providerAttempts || 1,
        ...(timedOut ? { totalProviderTimeoutBudgetMs: 14_000 } : {}),
      },
    }, error);
    return NextResponse.json(
      {
        error: "云端发音暂时不可用。",
        code,
        ...reportReference(report),
      },
      { status },
    );
  }
}
