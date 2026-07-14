import {
  DeepSeekParseError,
  MissingDeepSeekEnvError,
  sanitizeSentenceQuestionRequest,
} from "@/lib/deepseek";
import type { SentenceQuestionAnswer, SentenceQuestionRequest } from "@/types/reader";
import type { ProviderTokenUsage } from "@/lib/usageCost";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_FALLBACK_MODEL = "deepseek-chat";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS_PER_PROFILE = 2;

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderTokenUsage;
}

export interface SentenceQuestionResult extends SentenceQuestionAnswer {
  usage: ProviderTokenUsage;
  model: string;
  provider: string;
}

interface ProviderProfile {
  apiKey: string;
  baseURL: string;
  model: string;
  label: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isDeepSeekBusy(message = ""): boolean {
  return /service is too busy|temporarily switch|too busy|rate limit|overloaded/i.test(message);
}

function friendlyDeepSeekError(message = "", status?: number): string {
  if (isDeepSeekBusy(message) || status === 429 || status === 503) {
    return "DeepSeek 当前服务繁忙，已自动重试和切换备用模型但仍失败。请稍后再试。";
  }
  if (status === 401 || status === 403) {
    return "DeepSeek API Key 无效或没有权限，请检查环境变量配置。";
  }
  return message || "DeepSeek 请求失败，请稍后重试。";
}

function getProviderProfiles(): ProviderProfile[] {
  const primaryApiKey = process.env.DEEPSEEK_API_KEY;
  const primaryBaseURL = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL;
  const primaryModel = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  if (!primaryApiKey) {
    return [];
  }

  const fallbackModels = uniqueValues([
    ...(process.env.DEEPSEEK_FALLBACK_MODELS ?? "").split(","),
    DEFAULT_FALLBACK_MODEL,
  ]).filter((model) => model !== primaryModel);

  return [
    {
      apiKey: primaryApiKey,
      baseURL: primaryBaseURL,
      model: primaryModel,
      label: "primary",
    },
    ...fallbackModels.map((model) => ({
      apiKey: primaryApiKey,
      baseURL: primaryBaseURL,
      model,
      label: `fallback-model:${model}`,
    })),
  ];
}

export async function answerSentenceQuestionWithDeepSeek(
  request: SentenceQuestionRequest,
): Promise<SentenceQuestionResult> {
  const profiles = getProviderProfiles();

  if (profiles.length === 0) {
    throw new MissingDeepSeekEnvError("缺少 DEEPSEEK_API_KEY，请先配置环境变量。");
  }

  const safeRequest = sanitizeSentenceQuestionRequest(request);
  let lastError: DeepSeekParseError | null = null;

  for (const profile of profiles) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROFILE; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${profile.baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${profile.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: profile.model,
            temperature: 0.2,
            max_tokens: 850,
            thinking: {
              type: "disabled",
            },
            messages: [
              {
                role: "system",
                content:
                  "你是面向中文母语英语学习者的句子追问助手。用户会给出一个划词或短语、它所在的英文句子、前后句，以及一个自由问题。问题可能关于句子主干、结构、修饰关系、指代、逻辑，也可能只问句中某个词为什么这样用、为什么用这个时态/介词/搭配/语气，或这句话的任何局部细节。请优先回答用户实际问的问题，并结合该句语境解释；不要只按句法分析模板回答，也不要泛泛讲整篇文章。回答使用中文，长度适中，通常 250 到 500 个汉字；必要时可以简短分点。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  selectedText: safeRequest.word,
                  sentence: safeRequest.sentence,
                  previousSentence: safeRequest.previousSentence,
                  nextSentence: safeRequest.nextSentence,
                  question: safeRequest.question,
                }),
              },
            ],
          }),
          signal: controller.signal,
        });

        const completion = (await response.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
        if (!response.ok || !completion) {
          const message = friendlyDeepSeekError(completion?.error?.message, response.status);
          lastError = new DeepSeekParseError(message);
          if (
            attempt < MAX_ATTEMPTS_PER_PROFILE &&
            (response.status === 429 || response.status === 503 || isDeepSeekBusy(completion?.error?.message))
          ) {
            await wait(600);
            continue;
          }
          break;
        }

        const answer = completion.choices?.[0]?.message?.content?.trim();
        if (answer) {
          return { answer, usage: completion.usage ?? {}, model: profile.model, provider: profile.label };
        }

        lastError = new DeepSeekParseError("DeepSeek 没有返回问答内容，请换一种问法再试。");
        break;
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "DeepSeek 响应超时，请稍后重试。"
            : "DeepSeek 请求失败，请检查网络或 API 配置。";
        lastError = new DeepSeekParseError(message);
        if (attempt < MAX_ATTEMPTS_PER_PROFILE) {
          await wait(500);
          continue;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    console.warn("Sentence question profile failed", {
      profile: profile.label,
      model: profile.model,
      message: lastError?.message,
    });
  }

  throw lastError ?? new DeepSeekParseError("DeepSeek 请求失败，请稍后重试。");
}
