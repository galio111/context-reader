import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { Difficulty, ExplanationRequest, WordExplanation } from "@/types/reader";

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_FALLBACK_MODEL = "deepseek-chat";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_CONTEXT_CHARS = 1300;
const MAX_SINGLE_FIELD_CHARS = 500;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS_PER_PROFILE = 2;

const systemPrompt = `你是面向中文母语大学生的英语阅读和 Anki 制卡助手。用户会给你一个英文单词或短语、它所在的英文句子、前一句和后一句。你需要解释该词在当前语境中的含义，并判断当前句子是否适合制作语境挖空卡。

回答必须使用中文。不要输出 Markdown。不要输出多余文字。只返回严格 JSON。

返回字段：
{
  "word": "被点击的原词",
  "lemma": "单词原形",
  "phonetic": "IPA 音标，例如 /əˈdres/，不知道则为空字符串",
  "partOfSpeech": "词性，用中文，例如 动词/名词/形容词/副词/短语",
  "basicMeaning": "基础中文释义，脱离具体语境的基础义项",
  "contextMeaning": "该词在当前句子中的语境含义，必须是中文",
  "sentenceTranslation": "当前句子的自然中文翻译",
  "usageNote": "这个词在这里的用法说明，必须是中文",
  "collocation": "常见搭配或固定表达，没有则写空字符串",
  "exampleEnglish": "一个简单英文例句",
  "exampleChinese": "例句中文翻译",
  "difficulty": "easy / medium / hard",
  "shouldAddToVocabulary": true,
  "anki": {
    "canMakeCloze": true,
    "cardMode": "cloze_context",
    "clozeSentence": "只把原句中的目标词替换成 ________",
    "contextCue": "来自 contextMeaning 的中文语境提示",
    "basicCue": "来自 basicMeaning 的中文基础释义提示"
  }
}

判断规则：
1. 默认优先 canMakeCloze=true。实义词、学术词、动词、名词、形容词、副词、短语动词、固定表达，通常都适合语境挖空。
2. 不要求挖空后只有唯一答案；只要能通过英文句子和中文语境提示回忆目标词即可。
3. 只有功能词、句子极短且无线索、上下文无法体现目标词用法、答案过于开放时，才 canMakeCloze=false，cardMode="basic_cn_to_en"。
4. canMakeCloze=true 时 cardMode="cloze_context"；canMakeCloze=false 时 cardMode="basic_cn_to_en"。
5. clozeSentence 只能替换原句目标词，不要改写整句。
6. basicCue 必须来自 basicMeaning，不要来自 contextMeaning。
7. contextCue 必须来自 contextMeaning，可以简化但不要编造。
8. 除 word、lemma、phonetic、clozeSentence、exampleEnglish 外，所有解释字段必须使用中文。
9. 每个字段都必须存在，不要返回 null。内容要短，不要长篇展开。`;

export class MissingDeepSeekEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDeepSeekEnvError";
  }
}

export class DeepSeekParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekParseError";
  }
}

interface DeepSeekChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface ProviderProfile {
  apiKey: string;
  baseURL: string;
  model: string;
  label: string;
}

function trimField(value: string): string {
  return value.trim().slice(0, MAX_SINGLE_FIELD_CHARS);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function bool(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function difficulty(value: unknown): Difficulty {
  return value === "easy" || value === "medium" || value === "hard" ? value : "medium";
}

function firstMeaning(value: string): string {
  return value.split(/[。；;\n]/).map((item) => item.trim()).filter(Boolean)[0] || value;
}

function isDeepSeekBusy(message = ""): boolean {
  return /service is too busy|temporarily switch|too busy|rate limit|overloaded/i.test(message);
}

function friendlyDeepSeekError(message = "", status?: number): string {
  if (isDeepSeekBusy(message) || status === 429 || status === 503) {
    return "DeepSeek 当前服务繁忙，已自动重试和切换备用模型但仍失败。请稍后再点一次，或配置备用 API 地址。";
  }
  if (status === 401 || status === 403) {
    return "DeepSeek API Key 无效或没有权限，请检查 .env.local。";
  }
  return message || "DeepSeek 请求失败，请稍后重试。";
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }
    throw new DeepSeekParseError("模型没有返回可解析的 JSON，请重新点击该词。");
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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

  const profiles: ProviderProfile[] = [
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

  const fallbackBaseURL = process.env.DEEPSEEK_FALLBACK_BASE_URL;
  const fallbackApiKey = process.env.DEEPSEEK_FALLBACK_API_KEY || primaryApiKey;
  const fallbackModel = process.env.DEEPSEEK_FALLBACK_MODEL || primaryModel;

  if (fallbackBaseURL) {
    profiles.push({
      apiKey: fallbackApiKey,
      baseURL: fallbackBaseURL,
      model: fallbackModel,
      label: "fallback-provider",
    });
  }

  return profiles;
}

export function sanitizeExplanationRequest(input: ExplanationRequest): ExplanationRequest {
  const request = {
    word: trimField(input.word),
    sentence: trimField(input.sentence),
    previousSentence: trimField(input.previousSentence ?? ""),
    nextSentence: trimField(input.nextSentence ?? ""),
  };

  const totalLength =
    request.word.length +
    request.sentence.length +
    request.previousSentence.length +
    request.nextSentence.length;

  if (totalLength > MAX_CONTEXT_CHARS) {
    return {
      ...request,
      previousSentence: request.previousSentence.slice(0, 250),
      sentence: request.sentence.slice(0, 700),
      nextSentence: request.nextSentence.slice(0, 250),
    };
  }

  return request;
}

function normalizeExplanation(value: unknown, request: ExplanationRequest): WordExplanation {
  const data = (value && typeof value === "object" ? value : {}) as Partial<WordExplanation>;
  const basicMeaning = text(data.basicMeaning, "待补充基础释义");
  const contextMeaning = text(data.contextMeaning, basicMeaning || "待补充语境含义");
  const sentenceTranslation = text(data.sentenceTranslation, "待补充句子翻译");
  const usageNote = text(data.usageNote, "结合原句理解该词在当前语境中的用法。");
  const exampleEnglish = text(data.exampleEnglish, `${request.word} is useful.`);
  const exampleChinese = text(data.exampleChinese, "这个词很有用。");

  const ankiSource = {
    ...data,
    word: text(data.word, request.word),
    basicMeaning,
    contextMeaning,
    anki: {
      ...((data.anki ?? {}) as object),
      contextCue: text(data.anki?.contextCue, firstMeaning(contextMeaning)),
      basicCue: text(data.anki?.basicCue, firstMeaning(basicMeaning)),
      frontPreview: "",
      backPreview: "",
    },
  } as Partial<WordExplanation>;

  return {
    word: text(data.word, request.word),
    lemma: text(data.lemma, request.word.toLowerCase()),
    phonetic: text(data.phonetic, ""),
    partOfSpeech: text(data.partOfSpeech, "词性待确认"),
    basicMeaning,
    contextMeaning,
    sentenceTranslation,
    usageNote,
    collocation: text(data.collocation, ""),
    exampleEnglish,
    exampleChinese,
    difficulty: difficulty(data.difficulty),
    shouldAddToVocabulary: bool(data.shouldAddToVocabulary, true),
    anki: normalizeAnkiInfo(ankiSource, request.sentence),
  };
}

async function requestDeepSeekCompletion(args: {
  profile: ProviderProfile;
  safeRequest: ExplanationRequest;
}): Promise<DeepSeekChatCompletionResponse> {
  let lastError: DeepSeekParseError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROFILE; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${args.profile.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.profile.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: args.profile.model,
          temperature: 0,
          max_tokens: 620,
          response_format: { type: "json_object" },
          thinking: {
            type: "disabled",
          },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                word: args.safeRequest.word,
                sentence: args.safeRequest.sentence,
                previousSentence: args.safeRequest.previousSentence,
                nextSentence: args.safeRequest.nextSentence,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      const completion = (await response.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
      if (response.ok && completion) {
        return completion;
      }

      const message = friendlyDeepSeekError(completion?.error?.message, response.status);
      lastError = new DeepSeekParseError(message);
      if (attempt < MAX_ATTEMPTS_PER_PROFILE && (response.status === 429 || response.status === 503 || isDeepSeekBusy(completion?.error?.message))) {
        await wait(600);
        continue;
      }
      throw lastError;
    } catch (error) {
      if (error instanceof DeepSeekParseError) {
        throw error;
      }

      const message = error instanceof Error && error.name === "AbortError"
        ? "DeepSeek 响应超时，请稍后重试。"
        : "DeepSeek 请求失败，请检查网络或 API 配置。";
      lastError = new DeepSeekParseError(message);
      if (attempt < MAX_ATTEMPTS_PER_PROFILE) {
        await wait(500);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new DeepSeekParseError("DeepSeek 请求失败，请稍后重试。");
}

export async function explainWordWithDeepSeek(
  request: ExplanationRequest,
): Promise<WordExplanation> {
  const profiles = getProviderProfiles();

  if (profiles.length === 0) {
    throw new MissingDeepSeekEnvError("缺少 DEEPSEEK_API_KEY，请先配置 .env.local。");
  }

  const safeRequest = sanitizeExplanationRequest(request);
  let lastError: DeepSeekParseError | null = null;

  for (const profile of profiles) {
    try {
      const completion = await requestDeepSeekCompletion({ profile, safeRequest });
      const content = completion.choices?.[0]?.message?.content?.trim();

      if (!content) {
        console.warn("DeepSeek returned empty content", {
          profile: profile.label,
          model: profile.model,
          finishReason: completion.choices?.[0]?.finish_reason,
          hasReasoning: Boolean(completion.choices?.[0]?.message?.reasoning_content),
        });
        lastError = new DeepSeekParseError("DeepSeek 没有返回解释内容，请重新点击该词。");
        continue;
      }

      return normalizeExplanation(parseJsonObject(content), safeRequest);
    } catch (error) {
      if (error instanceof DeepSeekParseError) {
        lastError = error;
        console.warn("DeepSeek profile failed", {
          profile: profile.label,
          model: profile.model,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new DeepSeekParseError("DeepSeek 请求失败，请稍后重试。");
}
