import { normalizeAnkiInfo } from "@/lib/ankiData";
import { normalizePartOfSpeechLabel } from "@/lib/displayLabels";
import { pronunciationTargetMatches } from "@/lib/pronunciation";
import { ClientRequestCancelledError } from "@/lib/requestCancellation";
import { coreDeepSeekModelCandidates } from "@/lib/deepseekModelFailover";
import type {
  Difficulty,
  ExplanationRequest,
  SentenceQuestionRequest,
  WordExplanation,
} from "@/types/reader";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_CONTEXT_CHARS = 1100;
const MAX_SINGLE_FIELD_CHARS = 500;
const MAX_QUESTION_CHARS = 500;
const REQUEST_TIMEOUT_MS = 26000;
const MAX_PROVIDER_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;
const MAX_COMPLETION_TOKENS = 760;
const REQUIRED_CHINESE_FIELDS = [
  "basicMeaning",
  "contextMeaning",
  "sentenceTranslation",
  "usageNote",
  "exampleChinese",
] as const;
const REQUIRED_TEXT_FIELDS = [
  "collocation",
] as const;

const systemPrompt = `你是给中文母语英语学习者使用的语境词义助手。用户输入 JSON：w=目标词/短语，s=当前句，p=前一句，n=后一句。
要求：
1. 必须返回严格 JSON，不要 Markdown，不要额外文字。
2. 中文字段要短、准、自然，重点解释当前语境，不要堆砌词典义。
3. sentenceTranslation 必须翻译整句，并让目标词/短语在句中的语气、指代、逻辑关系都被准确体现。
4. word 必须原样返回输入的 w，不能添加相邻单词、释义或原型。
5. phonetic 尽量给 IPA，且必须描述用户实际选择的 w，绝不能改成 lemma（原型）的音标。phoneticFor 必须原样返回 w，用来明确音标归属；无法确认 w 的音标时，phonetic 和 phoneticFor 都返回空字符串。w 是单个单词时只给该词当前词形的音标；w 是多词短语时按“单词 /音标/ · 单词 /音标/”列出每个实际选中词形，不要给整段句子音标。
6. w 是单个单词时，lemma 只返回这个单词在该句中的原型，严禁返回相邻词或多个单词；w 是多词短语时 lemma 返回空字符串。partOfSpeech 只返回规范词性，不要把 CET、IELTS、A2、B2、medium 等考试或等级写进词性。
7. contextMeaning 只能写目标词/短语在当前句中的中文对应含义，不得翻译整句。w 是单个单词时，contextMeaning 必须解释这个单词本身在句中的贡献，不能把相邻副词、否定词、程度词或搭配词的整体效果并入释义。例如 w=intelligible 且原句含 barely intelligible 时，contextMeaning 应写“可理解的；听得清的”，不要写“口齿不清的”；“barely intelligible”的整体效果应放在 sentenceTranslation 或 usageNote。w 是用户选中的多词短语时，contextMeaning 才解释整个短语。sentenceTranslation 才翻译整句。
8. difficulty 只返回 easy、medium、hard 三者之一。
9. clozeSentence 只把原句中的目标词/短语替换成 ________，不要改写整句。
10. 判断 Anki 卡片类型时，优先考虑“保留原句语境是否能帮助回忆目标表达”，不要按词长、词频或词性筛选。只要能在原句中准确定位目标词/短语、仅将它替换为 ________，且挖空后仍保留其他英文语境，canMakeCloze 必须为 true，cardMode 必须为 cloze_context。短词以及介词、副词、连词、代词、助动词等功能词往往更依赖上下文辨析，同样应当语境挖空，不能因此降级。只有以下结构性情况才返回 canMakeCloze=false、cardMode=basic_cn_to_en：s 为空；w 为空；w 未出现在 s 中；无法只替换 w 而保持原句其余内容不变；或 w 覆盖整句，挖空后没有任何可用英文语境。不要用“线索太少”“词太简单”“功能词”等主观理由判为 false。
11. collocation 必须填写：优先给 2-4 个常见英文搭配，每个搭配后紧跟简短中文释义，格式严格为“service fee（服务费）；legal fee（律师费）”；如果确实没有固定搭配，写“无固定搭配”，不要留空。collocation 只能包含搭配，exampleEnglish 只能包含一个英文例句，exampleChinese 只能包含这个例句的一条中文翻译，三个字段严禁互相串入内容。
返回字段：
{"word":"","lemma":"","phonetic":"","phoneticFor":"","partOfSpeech":"","basicMeaning":"","contextMeaning":"","sentenceTranslation":"","usageNote":"","collocation":"","exampleEnglish":"","exampleChinese":"","difficulty":"easy","shouldAddToVocabulary":true,"anki":{"canMakeCloze":true,"cardMode":"cloze_context","clozeSentence":"","contextCue":"","basicCue":""}}`;

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

export class DeepSeekHttpError extends DeepSeekParseError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly providerCode = "",
  ) {
    super(message);
    this.name = "DeepSeekHttpError";
  }
}

export class DeepSeekTimeoutError extends DeepSeekParseError {
  constructor(message = "DeepSeek 响应超时，请重新生成。") {
    super(message);
    this.name = "DeepSeekTimeoutError";
  }
}

export class DeepSeekTransportError extends DeepSeekParseError {
  constructor(message = "DeepSeek 请求失败，请稍后重试。") {
    super(message);
    this.name = "DeepSeekTransportError";
  }
}

export class DeepSeekEmptyContentError extends DeepSeekParseError {
  constructor(message = "DeepSeek 没有返回解释内容，请重新生成。") {
    super(message);
    this.name = "DeepSeekEmptyContentError";
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
  usage?: {
    prompt_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens?: number;
  };
}

export interface DeepSeekExplanationResult {
  explanation: WordExplanation;
  model: string;
  provider: string;
  usage: NonNullable<DeepSeekChatCompletionResponse["usage"]>;
}

function sumUsage(...items: Array<DeepSeekChatCompletionResponse["usage"]>): NonNullable<DeepSeekChatCompletionResponse["usage"]> {
  return items.reduce<NonNullable<DeepSeekChatCompletionResponse["usage"]>>((sum, item) => ({
    prompt_tokens: (sum.prompt_tokens ?? 0) + (item?.prompt_tokens ?? 0),
    prompt_cache_hit_tokens: (sum.prompt_cache_hit_tokens ?? 0) + (item?.prompt_cache_hit_tokens ?? 0),
    prompt_cache_miss_tokens: (sum.prompt_cache_miss_tokens ?? 0) + (item?.prompt_cache_miss_tokens ?? 0),
    completion_tokens: (sum.completion_tokens ?? 0) + (item?.completion_tokens ?? 0),
  }), {});
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

function lexicalWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
}

function normalizeLemma(value: unknown, selectedWord: string): string {
  const selectedWords = lexicalWords(selectedWord);
  if (selectedWords.length !== 1) {
    return "";
  }

  const candidate = text(value).toLowerCase();
  return lexicalWords(candidate).length === 1 ? candidate : selectedWords[0];
}

function hasChineseContent(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function missingChineseFields(value: unknown): string[] {
  const data = (value && typeof value === "object" ? value : {}) as Partial<Record<(typeof REQUIRED_CHINESE_FIELDS)[number], unknown>>;

  return REQUIRED_CHINESE_FIELDS.filter((field) => {
    const fieldValue = data[field];
    return typeof fieldValue !== "string" || !hasChineseContent(fieldValue.trim());
  });
}

function missingTextFields(value: unknown): string[] {
  const data = (value && typeof value === "object" ? value : {}) as Partial<Record<(typeof REQUIRED_TEXT_FIELDS)[number], unknown>>;

  return REQUIRED_TEXT_FIELDS.filter((field) => {
    const fieldValue = data[field];
    return typeof fieldValue !== "string" || fieldValue.trim().length === 0;
  });
}

function isDeepSeekBusy(message = ""): boolean {
  return /service is too busy|temporarily switch|too busy|rate limit|overloaded/i.test(message);
}

function friendlyDeepSeekError(message = "", status?: number): string {
  if (isDeepSeekBusy(message) || status === 429 || status === 503) {
    return "DeepSeek 当前服务繁忙，请稍后重新生成。";
  }
  if (status === 401 || status === 403) {
    return "DeepSeek API Key 无效或没有权限，请检查 .env.local。";
  }
  return message || "DeepSeek 请求失败，请稍后重试。";
}

function isRetryableProviderError(error: unknown): boolean {
  return (
    error instanceof DeepSeekTimeoutError ||
    error instanceof DeepSeekTransportError ||
    (error instanceof DeepSeekHttpError && (error.status === 429 || error.status >= 500))
  );
}

function waitForProviderRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS * attempt);
  });
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
    throw new DeepSeekParseError("模型没有返回可解析的 JSON，请重新生成。");
  }
}

function getProviderProfiles(): ProviderProfile[] {
  const primaryApiKey = process.env.DEEPSEEK_API_KEY;
  const primaryBaseURL = process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL;
  const primaryModel = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  if (!primaryApiKey) {
    return [];
  }

  const profiles: ProviderProfile[] = [
    {
      apiKey: primaryApiKey,
      baseURL: primaryBaseURL,
      model: primaryModel,
      label: "primary",
    },
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

  const explicitFallbackModels = coreDeepSeekModelCandidates(primaryModel, process.env.DEEPSEEK_FALLBACK_MODELS)
    .slice(1)
    .filter((model) => model !== primaryModel);
  profiles.push(
    ...explicitFallbackModels.map((model) => ({
      apiKey: primaryApiKey,
      baseURL: primaryBaseURL,
      model,
      label: `fallback-model:${model}`,
    })),
  );

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
      previousSentence: request.previousSentence.slice(0, 220),
      sentence: request.sentence.slice(0, 620),
      nextSentence: request.nextSentence.slice(0, 220),
    };
  }

  return request;
}

export function sanitizeSentenceQuestionRequest(input: SentenceQuestionRequest): SentenceQuestionRequest {
  return {
    ...sanitizeExplanationRequest(input),
    question: trimField(input.question).slice(0, MAX_QUESTION_CHARS),
  };
}

function normalizeExplanation(value: unknown, request: ExplanationRequest): WordExplanation {
  const data = (value && typeof value === "object" ? value : {}) as Partial<WordExplanation>;
  const basicMeaning = text(data.basicMeaning, "待补充基础释义");
  const contextMeaning = text(data.contextMeaning, basicMeaning || "待补充语境含义");
  const sentenceTranslation = text(data.sentenceTranslation, "待补充句子翻译");
  const usageNote = text(data.usageNote, "结合原句理解该词在当前语境中的用法。");
  const collocation = text(data.collocation, "无固定搭配");
  const exampleEnglish = text(data.exampleEnglish, `${request.word} is useful.`);
  const exampleChinese = text(data.exampleChinese, "这个词很有用。");

  const ankiSource = {
    ...data,
    word: request.word,
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
    word: request.word,
    lemma: normalizeLemma(data.lemma, request.word),
    phonetic: pronunciationTargetMatches(text(data.phoneticFor), request.word)
      ? text(data.phonetic, "")
      : "",
    phoneticFor: pronunciationTargetMatches(text(data.phoneticFor), request.word)
      ? request.word
      : "",
    partOfSpeech: normalizePartOfSpeechLabel(text(data.partOfSpeech, "词性待确认")),
    basicMeaning,
    contextMeaning,
    sentenceTranslation,
    usageNote,
    collocation,
    exampleEnglish,
    exampleChinese,
    difficulty: difficulty(data.difficulty),
    shouldAddToVocabulary: bool(data.shouldAddToVocabulary, true),
    anki: normalizeAnkiInfo(ankiSource, request.sentence),
  };
}

async function requestDeepSeekCompletionOnce(args: {
  profile: ProviderProfile;
  safeRequest: ExplanationRequest;
  repairChineseFields?: string[];
  signal?: AbortSignal;
}): Promise<DeepSeekChatCompletionResponse> {
  const controller = new AbortController();
  let abortCause: "client" | "timeout" | null = null;
  const abortFromClient = () => {
    if (abortCause) return;
    abortCause = "client";
    controller.abort();
  };
  if (args.signal?.aborted) {
    abortFromClient();
  } else {
    args.signal?.addEventListener("abort", abortFromClient, { once: true });
  }
  const timeoutId = setTimeout(() => {
    if (abortCause) return;
    abortCause = "timeout";
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

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
        max_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        thinking: {
          type: "disabled",
        },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(
              args.repairChineseFields?.length
                ? {
                    w: args.safeRequest.word,
                    s: args.safeRequest.sentence,
                    p: args.safeRequest.previousSentence,
                    n: args.safeRequest.nextSentence,
                    fix: `上次返回的 ${args.repairChineseFields.join(", ")} 不合格。basicMeaning、contextMeaning、sentenceTranslation、usageNote、exampleChinese 必须使用中文，不要把英文释义原样放进这些字段。collocation 必须填写常见英文搭配；没有固定搭配时写“无固定搭配”。`,
                  }
                : {
                    w: args.safeRequest.word,
                    s: args.safeRequest.sentence,
                    p: args.safeRequest.previousSentence,
                    n: args.safeRequest.nextSentence,
                  },
            ),
          },
        ],
      }),
      signal: controller.signal,
    });

    const completion = (await response.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
    if (response.ok) {
      if (completion) {
        return completion;
      }
      throw new DeepSeekParseError("DeepSeek 返回了无法读取的响应，请重新生成。");
    }

    throw new DeepSeekHttpError(
      friendlyDeepSeekError(completion?.error?.message, response.status),
      response.status,
      text((completion?.error as { code?: unknown } | undefined)?.code),
    );
  } catch (error) {
    if (error instanceof DeepSeekParseError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError" && abortCause === "client") {
      throw new ClientRequestCancelledError();
    }
    if (error instanceof Error && error.name === "AbortError" && abortCause === "timeout") {
      throw new DeepSeekTimeoutError();
    }

    const cause = error && typeof error === "object" && "cause" in error
      ? (error as { cause?: { name?: unknown; code?: unknown; message?: unknown } }).cause
      : undefined;
    console.error("[deepseek] Upstream request failed", {
      profile: args.profile.label,
      model: args.profile.model,
      baseURL: args.profile.baseURL,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : "",
      causeName: typeof cause?.name === "string" ? cause.name : "",
      causeCode: typeof cause?.code === "string" ? cause.code : "",
      causeMessage: typeof cause?.message === "string" ? cause.message.slice(0, 300) : "",
    });

    throw new DeepSeekTransportError();
  } finally {
    clearTimeout(timeoutId);
    args.signal?.removeEventListener("abort", abortFromClient);
  }
}

async function requestDeepSeekCompletion(args: {
  profile: ProviderProfile;
  safeRequest: ExplanationRequest;
  repairChineseFields?: string[];
  signal?: AbortSignal;
}): Promise<DeepSeekChatCompletionResponse> {
  let lastError: DeepSeekParseError | null = null;

  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      return await requestDeepSeekCompletionOnce(args);
    } catch (error) {
      if (!(error instanceof DeepSeekParseError)) {
        throw error;
      }

      lastError = error;
      if (!isRetryableProviderError(error) || attempt === MAX_PROVIDER_ATTEMPTS) {
        throw error;
      }

      console.warn("[deepseek] Retrying transient provider failure", {
        profile: args.profile.label,
        model: args.profile.model,
        attempt,
        errorName: error.name,
        status: error instanceof DeepSeekHttpError ? error.status : undefined,
        providerCode: error instanceof DeepSeekHttpError ? error.providerCode : undefined,
      });
      await waitForProviderRetry(attempt);
    }
  }

  throw lastError ?? new DeepSeekTransportError();
}

export async function explainWordWithDeepSeek(
  request: ExplanationRequest,
  signal?: AbortSignal,
): Promise<DeepSeekExplanationResult> {
  const profiles = getProviderProfiles();

  if (profiles.length === 0) {
    throw new MissingDeepSeekEnvError("缺少 DEEPSEEK_API_KEY，请先配置 .env.local。");
  }

  const safeRequest = sanitizeExplanationRequest(request);
  let lastError: DeepSeekParseError | null = null;

  for (const profile of profiles) {
    try {
      let completion = await requestDeepSeekCompletion({ profile, safeRequest, signal });
      let content = completion.choices?.[0]?.message?.content?.trim();

      if (!content) {
        console.warn("DeepSeek returned empty content", {
          profile: profile.label,
          model: profile.model,
          finishReason: completion.choices?.[0]?.finish_reason,
          hasReasoning: Boolean(completion.choices?.[0]?.message?.reasoning_content),
        });
        await waitForProviderRetry(1);
        const retryCompletion = await requestDeepSeekCompletion({ profile, safeRequest, signal });
        completion = {
          ...retryCompletion,
          usage: sumUsage(completion.usage, retryCompletion.usage),
        };
        content = retryCompletion.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new DeepSeekEmptyContentError();
        }
      }

      const parsed = parseJsonObject(content);
      let invalidFields = [...missingChineseFields(parsed), ...missingTextFields(parsed)];
      if (invalidFields.length > 0) {
        const retryCompletion = await requestDeepSeekCompletion({
          profile,
          safeRequest,
          repairChineseFields: invalidFields,
          signal,
        });
        const retryContent = retryCompletion.choices?.[0]?.message?.content?.trim();
        const retryParsed = retryContent ? parseJsonObject(retryContent) : null;
        invalidFields = [...missingChineseFields(retryParsed), ...missingTextFields(retryParsed)];
        if (invalidFields.length > 0) {
          throw new DeepSeekParseError("DeepSeek 返回的释义不完整，请重新生成。");
        }
        return { explanation: normalizeExplanation(retryParsed, safeRequest), model: profile.model, provider: profile.label, usage: sumUsage(completion.usage, retryCompletion.usage) };
      }

      return { explanation: normalizeExplanation(parsed, safeRequest), model: profile.model, provider: profile.label, usage: sumUsage(completion.usage) };
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
