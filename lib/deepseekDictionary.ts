import { DeepSeekParseError, MissingDeepSeekEnvError } from "@/lib/deepseek";
import { normalizeDictionarySpelling } from "@/lib/dictionarySpelling";
import { pronunciationTargetMatches } from "@/lib/pronunciation";
import type {
  DictionaryCollocation,
  DictionaryResult,
  DictionarySense,
  DictionarySynonym,
  DictionaryVerbForms,
  DictionaryWordFamilyItem,
} from "@/types/dictionary";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_COMPLETION_TOKENS = 2_400;

const dictionaryPrompt = `你是给中文母语英语学习者使用的双向深度英汉词典。用户会输入中文词语/短语，或一个英文单词/最多 8 个英文词的短语。
要求：
1. 只返回严格 JSON，不要 Markdown，不要额外文字。
2. 内容要比普通简明词典更有学习价值，但避免冗长堆砌。所有解释字段使用自然、准确的中文。
3. 英文输入使用 direction="en_to_cn"；中文输入使用 direction="cn_to_en"。query 必须原样保留用户输入。
4. 英译中时，lemma 是英文原形；phonetic 必须是用户实际输入 query 的 IPA，绝不能改成 lemma 的 IPA；phoneticFor 必须原样返回 query，用来明确音标归属，无法确认当前词形的音标时二者都留空。senses.meaning 是准确中文释义。先判断英文输入：真实表达用 inputStatus="valid"；正常词形变化用 "inflection"；明显拼写错误用 "misspelled" 并填写 suggestedQuery。拼错时不得编造内容，其他学习字段全部返回空值。
5. 中译英时，中文 query 才是词头。lemma 仅保存第一候选英文，phonetic 保存第一候选的 IPA，phoneticFor 保存第一候选英文，inputStatus 固定为 "valid"，suggestedQuery 为空。senses 按实际需要返回 1-4 个自然英文候选，不得默认只有一种，也不得为了凑数制造生硬近义词。中文词语能表示多种词性时（如“绑架”可作动词和名词），必须先按词性归类，再在各词性内给候选；同词性的候选必须相邻。每个候选的 meaning 是英文表达，phonetic 是该表达的 IPA，partOfSpeech 是准确英文词性，register 用中文写语域，usageNote 用一两句中文说明什么场景下选它，并提供一组自然英中例句。
6. 英译中必须保持深度词典的完整度：义项按常用中文含义区分，每个义项带自然英中例句；usageGuide 解释核心用法、语气和易混点；常见搭配返回 3-6 项；有合理内容时返回词族 2-5 项和近义词辨析 2-5 项；确有易错点时返回；memoryTip 返回可信且不牵强的记忆提示。不要因为流式界面而省略这些板块。
7. 英译中若词头或常见义项可作动词，verbForms 返回过去式、过去分词、现在分词；不是动词则为 null。中译英始终为 null。
8. 中译英的 usageGuide 只需简短比较各候选之间的选择差别，不重复逐项说明；collocations、wordFamily、synonyms 和 memoryTip 返回空数组或空字符串。
9. commonMistakes 仅在确有常见中式英语或选词误区时返回 0-3 条。
返回结构：
{"query":"","lemma":"","phonetic":"","phoneticFor":"","direction":"en_to_cn","inputStatus":"valid","suggestedQuery":"","senses":[{"partOfSpeech":"","meaning":"","phonetic":"","register":"","usageNote":"","exampleEnglish":"","exampleChinese":""}],"verbForms":{"pastTense":"","pastParticiple":"","presentParticiple":""},"usageGuide":"","collocations":[{"phrase":"","meaning":"","exampleEnglish":""}],"wordFamily":[{"word":"","partOfSpeech":"","meaning":""}],"synonyms":[{"word":"","difference":""}],"commonMistakes":[""],"memoryTip":""}`;

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
  const isChineseQuery = /[\u3400-\u9fff\uf900-\ufaff]/u.test(query);
  const senses = rows<DictionarySense>(data.senses, (item) => {
    const meaning = text(item.meaning);
    if (!meaning) return null;
    return {
      partOfSpeech: text(item.partOfSpeech, "词性待确认"),
      meaning,
      phonetic: text(item.phonetic),
      register: text(item.register, "常用"),
      usageNote: text(item.usageNote),
      exampleEnglish: text(item.exampleEnglish),
      exampleChinese: text(item.exampleChinese),
    };
  }, 4);
  const normalized = normalizeDictionarySpelling({
    query,
    lemma: isChineseQuery ? senses[0]?.meaning || text(data.lemma, query) : text(data.lemma, query),
    phonetic: isChineseQuery
      ? senses[0]?.phonetic || text(data.phonetic)
      : pronunciationTargetMatches(text(data.phoneticFor), query) ? text(data.phonetic) : "",
    phoneticFor: isChineseQuery
      ? senses[0]?.meaning || text(data.phoneticFor)
      : pronunciationTargetMatches(text(data.phoneticFor), query) ? query : "",
    direction: isChineseQuery ? "cn_to_en" : "en_to_cn",
    inputStatus:
      data.inputStatus === "inflection" || data.inputStatus === "misspelled"
        ? data.inputStatus
        : "valid",
    suggestedQuery: text(data.suggestedQuery),
    senses,
    verbForms: (() => {
      if (!data.verbForms || typeof data.verbForms !== "object") return null;
      const forms = data.verbForms as Record<string, unknown>;
      const normalizedForms: DictionaryVerbForms = {
        pastTense: text(forms.pastTense),
        pastParticiple: text(forms.pastParticiple),
        presentParticiple: text(forms.presentParticiple),
      };
      return Object.values(normalizedForms).some(Boolean) ? normalizedForms : null;
    })(),
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
  });
  if (normalized.inputStatus !== "misspelled" && !normalized.senses.length) {
    throw new DeepSeekParseError("词典服务没有返回有效义项，请重新查询。");
  }
  if (normalized.inputStatus === "misspelled" && !normalized.suggestedQuery) {
    throw new DeepSeekParseError("词典服务没有返回可用的拼写建议，请重新输入。");
  }
  return normalized;
}

export function sanitizeDictionaryQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

const ENGLISH_QUERY_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,7}$/;
const CHINESE_QUERY_PATTERN = /^[\u3400-\u9fff\uf900-\ufaff·\s]{1,24}$/u;

export function isValidStandaloneDictionaryQuery(query: string): boolean {
  if (ENGLISH_QUERY_PATTERN.test(query)) return true;
  return CHINESE_QUERY_PATTERN.test(query) && query.replace(/\s/g, "").length <= 16;
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
