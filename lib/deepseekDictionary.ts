import { DeepSeekParseError, MissingDeepSeekEnvError } from "@/lib/deepseek";
import type {
  DictionaryCollocation,
  DictionaryResult,
  DictionarySense,
  DictionarySynonym,
  DictionaryWordFamilyItem,
} from "@/types/dictionary";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_COMPLETION_TOKENS = 1_500;

const dictionaryPrompt = `你是给中文母语英语学习者使用的深度英汉词典。用户只输入一个英文单词或最多 8 个词的短语。
要求：
1. 只返回严格 JSON，不要 Markdown，不要额外文字。
2. 内容要比普通简明词典更有学习价值，但避免冗长堆砌。所有解释字段使用自然、准确的中文。
3. phonetic 尽量给 IPA。短语可按“word /音标/ · word /音标/”列出。
4. senses 给 1-4 个真正常用的义项；register 写“常用”“正式”“口语”“学术”等，没有特殊语域就写“常用”。每个义项必须带一组自然英中例句。
5. usageGuide 解释核心用法、语气、可数性或常见句型，重点说明学习者最容易混淆的地方。
6. collocations 给 3-6 个常见搭配及中文义，尽量附简短英文例句。
7. wordFamily 给 0-5 个同词根常用词；synonyms 给 0-5 个近义词并用中文说明差别。
8. commonMistakes 给 0-4 条中国学习者常犯错误；memoryTip 给一条可信的记忆提示，不编造词源。
返回结构：
{"query":"","lemma":"","phonetic":"","senses":[{"partOfSpeech":"","meaning":"","register":"","exampleEnglish":"","exampleChinese":""}],"usageGuide":"","collocations":[{"phrase":"","meaning":"","exampleEnglish":""}],"wordFamily":[{"word":"","partOfSpeech":"","meaning":""}],"synonyms":[{"word":"","difference":""}],"commonMistakes":[""],"memoryTip":""}`;

interface ProviderProfile {
  apiKey: string;
  baseURL: string;
  model: string;
  label: string;
}

interface DeepSeekDictionaryResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens?: number;
  };
}

export interface DeepSeekDictionaryResult {
  dictionary: DictionaryResult;
  model: string;
  provider: string;
  usage: NonNullable<DeepSeekDictionaryResponse["usage"]>;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function rows<T>(value: unknown, map: (item: Record<string, unknown>) => T | null, limit: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => (
    item && typeof item === "object" ? map(item as Record<string, unknown>) : null
  )).filter((item): item is T => item !== null);
}

function profiles(): ProviderProfile[] {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!apiKey) return [];
  const baseURL = (process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  const result: ProviderProfile[] = [{ apiKey, baseURL, model, label: "primary" }];
  const fallbackBaseURL = process.env.DEEPSEEK_FALLBACK_BASE_URL?.trim();
  if (fallbackBaseURL) {
    result.push({
      apiKey: process.env.DEEPSEEK_FALLBACK_API_KEY?.trim() || apiKey,
      baseURL: fallbackBaseURL.replace(/\/$/, ""),
      model: process.env.DEEPSEEK_FALLBACK_MODEL?.trim() || model,
      label: "fallback-provider",
    });
  }
  return result;
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new DeepSeekParseError("词典服务没有返回可解析的内容，请重新查询。");
  }
}

function normalizeDictionary(value: unknown, query: string): DictionaryResult {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const senses = rows<DictionarySense>(data.senses, (item) => {
    const meaning = text(item.meaning);
    if (!meaning) return null;
    return {
      partOfSpeech: text(item.partOfSpeech, "词性待确认"),
      meaning,
      register: text(item.register, "常用"),
      exampleEnglish: text(item.exampleEnglish),
      exampleChinese: text(item.exampleChinese),
    };
  }, 4);
  if (!senses.length) throw new DeepSeekParseError("词典服务没有返回有效义项，请重新查询。");

  return {
    query,
    lemma: text(data.lemma, query),
    phonetic: text(data.phonetic),
    senses,
    usageGuide: text(data.usageGuide, "请结合常见句型和例句理解这个表达。"),
    collocations: rows<DictionaryCollocation>(data.collocations, (item) => {
      const phrase = text(item.phrase);
      if (!phrase) return null;
      return { phrase, meaning: text(item.meaning), exampleEnglish: text(item.exampleEnglish) };
    }, 6),
    wordFamily: rows<DictionaryWordFamilyItem>(data.wordFamily, (item) => {
      const word = text(item.word);
      if (!word) return null;
      return { word, partOfSpeech: text(item.partOfSpeech), meaning: text(item.meaning) };
    }, 5),
    synonyms: rows<DictionarySynonym>(data.synonyms, (item) => {
      const word = text(item.word);
      if (!word) return null;
      return { word, difference: text(item.difference) };
    }, 5),
    commonMistakes: Array.isArray(data.commonMistakes)
      ? data.commonMistakes.map((item) => text(item)).filter(Boolean).slice(0, 4)
      : [],
    memoryTip: text(data.memoryTip),
  };
}

export function sanitizeDictionaryQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export async function lookupDictionaryWithDeepSeek(query: string): Promise<DeepSeekDictionaryResult> {
  const availableProfiles = profiles();
  if (!availableProfiles.length) {
    throw new MissingDeepSeekEnvError("缺少 DEEPSEEK_API_KEY，请先配置 .env.local。");
  }

  let lastError: Error | null = null;
  for (const profile of availableProfiles) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${profile.baseURL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${profile.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: profile.model,
          temperature: 0,
          max_tokens: MAX_COMPLETION_TOKENS,
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          messages: [
            { role: "system", content: dictionaryPrompt },
            { role: "user", content: JSON.stringify({ query }) },
          ],
        }),
        signal: controller.signal,
      });
      const completion = await response.json().catch(() => null) as DeepSeekDictionaryResponse | null;
      if (!response.ok || !completion) {
        throw new DeepSeekParseError(completion?.error?.message || "词典服务暂时不可用，请稍后重试。");
      }
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (!content) throw new DeepSeekParseError("词典服务返回了空内容，请重新查询。");
      return {
        dictionary: normalizeDictionary(parseJson(content), query),
        model: profile.model,
        provider: `deepseek:${profile.label}`,
        usage: completion.usage ?? {},
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("词典服务请求失败。");
    } finally {
      clearTimeout(timeoutId);
    }
  }
  if (lastError?.name === "AbortError") throw new DeepSeekParseError("词典查询超时，请重新查询。");
  throw lastError ?? new DeepSeekParseError("词典服务请求失败，请稍后重试。");
}
