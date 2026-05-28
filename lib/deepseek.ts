import { normalizeAnkiInfo } from "@/lib/ankiData";
import type { Difficulty, ExplanationRequest, WordExplanation } from "@/types/reader";

const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_CONTEXT_CHARS = 1300;
const MAX_SINGLE_FIELD_CHARS = 500;

const systemPrompt = `你是英语阅读词义解释助手。只返回严格 JSON，不要 Markdown，不要 JSON 外文字。

要求：
1. 除 word、lemma、clozeSentence、exampleEnglish 外，所有字段必须用中文。
2. basicMeaning 是脱离语境的中文基础释义。
3. contextMeaning 是当前句子里的中文语境含义。
4. 句子翻译、用法说明、搭配说明都必须是中文。
5. 每个字段都必须存在，不要返回 null。
6. 回答尽量短，字段内容不要长篇展开。

返回结构：
{
  "word": "原词",
  "lemma": "原形",
  "partOfSpeech": "中文词性",
  "basicMeaning": "中文基础释义",
  "contextMeaning": "中文语境含义",
  "sentenceTranslation": "自然中文翻译",
  "usageNote": "中文用法说明",
  "collocation": "常见搭配，没有则为空字符串",
  "exampleEnglish": "简单英文例句",
  "exampleChinese": "例句中文翻译",
  "difficulty": "easy / medium / hard",
  "shouldAddToVocabulary": true,
  "anki": {
    "canMakeCloze": true,
    "cardMode": "cloze_context",
    "clozeSentence": "把原句中的目标词替换成 ________",
    "contextCue": "来自 contextMeaning 的中文提示",
    "basicCue": "来自 basicMeaning 的中文提示"
  }
}

Anki 判断：
1. 默认优先 canMakeCloze=true。实义词、学术词、动词、名词、形容词、副词、短语动词、固定表达，通常都适合语境挖空。
2. 不要求挖空后只有唯一答案；只要能通过英文句子和中文语境提示回忆目标词即可。
3. 只有功能词、极短且无线索、无法体现目标词用法时，才 canMakeCloze=false，cardMode="basic_cn_to_en"。
4. canMakeCloze=true 时 cardMode="cloze_context"。
5. clozeSentence 只能替换原句目标词，不要改写整句。
6. basicCue 必须来自 basicMeaning；contextCue 必须来自 contextMeaning。`;

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

export async function explainWordWithDeepSeek(
  request: ExplanationRequest,
): Promise<WordExplanation> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    throw new MissingDeepSeekEnvError("缺少 DEEPSEEK_API_KEY，请先配置 .env.local。");
  }

  const safeRequest = sanitizeExplanationRequest(request);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
              word: safeRequest.word,
              sentence: safeRequest.sentence,
              previousSentence: safeRequest.previousSentence,
              nextSentence: safeRequest.nextSentence,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeepSeekParseError("DeepSeek 响应超时，请稍后重试。");
    }
    throw new DeepSeekParseError("DeepSeek 请求失败，请检查网络或 API 配置。");
  } finally {
    clearTimeout(timeoutId);
  }

  const completion = (await response.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
  if (!response.ok) {
    throw new DeepSeekParseError(
      completion?.error?.message || `DeepSeek 请求失败，HTTP ${response.status}。`,
    );
  }

  const content = completion?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    console.warn("DeepSeek returned empty content", {
      finishReason: completion?.choices?.[0]?.finish_reason,
      hasReasoning: Boolean(completion?.choices?.[0]?.message?.reasoning_content),
    });
    return normalizeExplanation({}, safeRequest);
  }

  return normalizeExplanation(parseJsonObject(content), safeRequest);
}
