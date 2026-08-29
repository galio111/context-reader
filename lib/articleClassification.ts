import {
  ARTICLE_AUDIENCE_STAGES,
  ARTICLE_CEFR_LEVELS,
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleAudienceStage,
  type ArticleCefrLevel,
  type ArticleDifficultyEvidence,
  type ArticleDifficulty,
  type ArticleSourceProfile,
  type ArticleTimeliness,
  type ArticleTopic,
  type ArticleVocabularyProfile,
} from "@/types/publicArticle";
import { articleEnglishWords, countArticleEnglishWords } from "@/lib/articleWordCount";
import { audienceForDifficulty } from "@/lib/articleAudience";
import { recordSystemUsageExecution } from "@/lib/accountStore";
import { estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";

const DEFAULT_MODEL = "deepseek-v4-pro";
const MAX_MODEL_TEXT_CHARS = 18_000;

interface DeepSeekClassificationResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  usage?: ProviderTokenUsage;
}

export interface ArticleClassificationResult {
  summary: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  wordCount: number;
  timeliness: ArticleTimeliness;
  reviewNotes: string;
  classificationSource: "model" | "heuristic";
  classifiedAt: string;
  difficultyEvidence: ArticleDifficultyEvidence;
  warning?: string;
}

export interface ArticleClassificationContext {
  sourceUrl?: string;
  sourceName?: string;
  usageRoute?: string;
}

interface ArticleTextMetrics {
  wordCount: number;
  sentenceCount: number;
  averageSentenceLength: number;
  longWordRatio: number;
  lexicalDiversity: number;
  complexSentenceRatio: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function textMetrics(text: string): ArticleTextMetrics {
  const words = articleEnglishWords(text);
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .map((item) => item.trim())
    .filter((item) => articleEnglishWords(item).length >= 2);
  const sampledWords = words.slice(0, 600).map((word) => word.toLowerCase());
  const complexSentenceCount = sentences.filter((sentence) => (
    /[,;:]|\b(?:although|because|while|whereas|unless|despite|which|whose|whom|that)\b/i.test(sentence)
  )).length;

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    averageSentenceLength: round(words.length / Math.max(1, sentences.length), 1),
    longWordRatio: round(
      words.filter((word) => word.replace(/[^A-Za-z]/g, "").length >= 9).length / Math.max(1, words.length),
      3,
    ),
    lexicalDiversity: round(new Set(sampledWords).size / Math.max(1, sampledWords.length), 3),
    complexSentenceRatio: round(complexSentenceCount / Math.max(1, sentences.length), 3),
  };
}

function sourceProfile(context: ArticleClassificationContext): ArticleSourceProfile {
  const source = `${context.sourceName ?? ""} ${context.sourceUrl ?? ""}`.toLowerCase();
  if (/\b(?:exam|cet[-_\s]?[46]|gaokao|ielts|toefl|test prep)\b/.test(source)) {
    return "exam";
  }
  if (/(?:learningenglish\.voanews|learnenglish|english learner|esl|efl|learning english)/.test(source)) {
    return "learner";
  }
  if (/(?:snexplores|kids?|teen|youth|young minds?|students?)/.test(source)) {
    return "youth";
  }
  if (/^https?:\/\//.test(context.sourceUrl?.trim() ?? "")) {
    return "general";
  }
  return "unknown";
}

function sourcePrior(profile: ArticleSourceProfile): string {
  const descriptions: Record<ArticleSourceProfile, string> = {
    general: "国外普通网站原生文章，默认按高中/CET-4以上审视，通常更接近CET-6或更高。",
    youth: "面向青少年公开发布的原生文章，允许在证据支持时判为初中或高中/CET-4。",
    learner: "面向英语学习者公开发布的原生文章，允许在证据支持时判为小学高年级或初中。",
    exam: "考试导向英文材料，结合目标考试与语言证据判断。",
    unknown: "来源受众未知，不因短句自动判为低龄，默认按高中/CET-4以上审视。",
  };
  return descriptions[profile];
}

function summaryFallback(title: string): string {
  const cleanTitle = title.trim() || "这篇文章";
  return `围绕“${cleanTitle}”展开的英文阅读文章，可在阅读过程中进行语境查词和短语理解。`;
}

function heuristicDifficulty(
  metrics: ArticleTextMetrics,
  profile: ArticleSourceProfile,
): { difficulty: ArticleDifficulty; cefr: ArticleCefrLevel } {
  const lowerBandsAllowed = profile === "learner" || profile === "youth" || profile === "exam";

  if (lowerBandsAllowed && metrics.averageSentenceLength <= 10.5 && metrics.longWordRatio < 0.055 && metrics.complexSentenceRatio < 0.18) {
    return { difficulty: "小学高年级", cefr: "A2" };
  }
  if (lowerBandsAllowed && metrics.averageSentenceLength <= 14 && metrics.longWordRatio < 0.1 && metrics.complexSentenceRatio < 0.28) {
    return { difficulty: "初中", cefr: "B1" };
  }
  if (metrics.averageSentenceLength <= 18 && metrics.longWordRatio < 0.14 && metrics.complexSentenceRatio < 0.38) {
    return { difficulty: "高中 / CET-4", cefr: "B2" };
  }
  if (metrics.averageSentenceLength <= 23 && metrics.longWordRatio < 0.2) {
    return { difficulty: "CET-6 / 考研", cefr: "C1" };
  }
  if (metrics.averageSentenceLength <= 29 && metrics.longWordRatio < 0.26) {
    return { difficulty: "雅思 / 托福基础", cefr: "C1" };
  }
  return { difficulty: "雅思 / 托福进阶", cefr: "C2" };
}

function cefrForDifficulty(difficulty: ArticleDifficulty): ArticleCefrLevel {
  const mapping: Record<ArticleDifficulty, ArticleCefrLevel> = {
    小学高年级: "A2",
    初中: "B1",
    "高中 / CET-4": "B2",
    "CET-6 / 考研": "C1",
    "雅思 / 托福基础": "C1",
    "雅思 / 托福进阶": "C2",
  };
  return mapping[difficulty];
}

function heuristicTopics(title: string, text: string): ArticleTopic[] {
  const sample = `${title} ${text.slice(0, 20_000)}`.toLowerCase();
  const topicPatterns: Array<[ArticleTopic, RegExp]> = [
    ["科技科学", /\b(?:science|technology|computer|internet|space|research|energy|physics|biology|ai|robot|digital)\b/i],
    ["自然环境", /\b(?:nature|climate|environment|ocean|forest|animal|plant|earth|weather|wildlife|ecology)\b/i],
    ["文化历史", /\b(?:culture|history|ancient|museum|art|tradition|language|heritage|century|civilization)\b/i],
    ["社会生活", /\b(?:society|city|work|education|health|family|community|economy|daily|public|media)\b/i],
    ["人物成长", /\b(?:life|career|learn|growth|mind|psychology|habit|success|failure|person|people|interview)\b/i],
    ["故事文学", /\b(?:story|novel|fiction|poem|literature|character|writer|memoir|tale|narrative)\b/i],
  ];
  const matched = topicPatterns.filter(([, pattern]) => pattern.test(sample)).map(([topic]) => topic);
  return matched.length ? matched.slice(0, 3) : ["社会生活"];
}

function heuristicTimeliness(text: string): ArticleTimeliness {
  const sample = text.slice(0, 25_000);
  const year = new Date().getUTCFullYear();
  const datedEventPattern = new RegExp(`\\b(?:${year - 1}|${year}|${year + 1})\\b|\\b(?:today|yesterday|this week|breaking|election|quarter|latest)\\b`, "i");
  return datedEventPattern.test(sample) ? "time-sensitive" : "evergreen";
}

function fallbackAbstractness(title: string, text: string): number {
  const sample = `${title} ${text.slice(0, 12_000)}`;
  const matches = sample.match(/\b(?:theory|concept|system|policy|identity|culture|economy|ethics|philosophy|framework|ideology|consciousness)\b/gi)?.length ?? 0;
  return Math.max(1, Math.min(5, 1 + Math.ceil(matches / 4)));
}

function fallbackBackgroundKnowledge(title: string, text: string): number {
  const sample = `${title} ${text.slice(0, 12_000)}`;
  const matches = sample.match(/\b(?:according to|researchers|historical|constitutional|quantum|genetic|geopolitical|archaeological|macroeconomic|methodology)\b/gi)?.length ?? 0;
  return Math.max(1, Math.min(5, 1 + Math.ceil(matches / 3)));
}

function heuristicResult(
  title: string,
  text: string,
  context: ArticleClassificationContext,
  warning?: string,
): ArticleClassificationResult {
  const metrics = textMetrics(text);
  const profile = sourceProfile(context);
  const { difficulty, cefr } = heuristicDifficulty(metrics, profile);
  const evidence: ArticleDifficultyEvidence = {
    ...metrics,
    sourceProfile: profile,
    sourcePrior: sourcePrior(profile),
    abstractness: fallbackAbstractness(title, text),
    backgroundKnowledge: fallbackBackgroundKnowledge(title, text),
    challengingTerms: [],
    confidence: "low",
    rationale: "本地兜底综合句长、长词比例、句法复杂度、词汇多样度和来源受众判断；词汇等级分布需模型分析。",
  };
  return {
    summary: summaryFallback(title),
    difficulty,
    cefr,
    audienceStages: audienceForDifficulty(difficulty),
    topics: heuristicTopics(title, text),
    wordCount: metrics.wordCount,
    timeliness: heuristicTimeliness(text),
    reviewNotes: "当前为本地兜底判断，发布前请结合难度证据复核。",
    classificationSource: "heuristic",
    classifiedAt: new Date().toISOString(),
    difficultyEvidence: evidence,
    ...(warning ? { warning } : {}),
  };
}

function compactModelText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_MODEL_TEXT_CHARS) {
    return clean;
  }
  return `${clean.slice(0, 13_000)}\n\n[中段省略]\n\n${clean.slice(-5_000)}`;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const value = JSON.parse(stripped.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function allowedValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : fallback;
}

function allowedValues<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number][]): T[number][] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const unique = [...new Set(value.filter((item): item is T[number] => typeof item === "string" && allowed.includes(item)))];
  return unique.length ? unique : fallback;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function vocabularyProfile(value: unknown): ArticleVocabularyProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const raw = [
    boundedNumber(item.a2OrBelow, 0, 100, 0),
    boundedNumber(item.b1, 0, 100, 0),
    boundedNumber(item.b2, 0, 100, 0),
    boundedNumber(item.c1OrAbove, 0, 100, 0),
  ];
  const total = raw.reduce((sum, number) => sum + number, 0);
  if (total <= 0) {
    return undefined;
  }
  const normalized = raw.map((number) => Math.round((number / total) * 100));
  normalized[0] += 100 - normalized.reduce((sum, number) => sum + number, 0);
  return {
    a2OrBelow: normalized[0],
    b1: normalized[1],
    b2: normalized[2],
    c1OrAbove: normalized[3],
  };
}

function challengingTerms(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 8);
}

export async function classifyArticle(
  title: string,
  text: string,
  context: ArticleClassificationContext = {},
): Promise<ArticleClassificationResult> {
  const fallback = heuristicResult(title, text, context);
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return heuristicResult(title, text, context, "未配置 DeepSeek，当前使用本地多证据难度规则。");
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const metrics = textMetrics(text);
  const profile = sourceProfile(context);
  const prompt = `你是面向中国英语学习者的英文文章分级编辑。请基于可核查证据判断，不要因为句子短就把国外原生文章判成小学或初中。

来源名称：${context.sourceName?.trim() || "未知"}
来源网址：${context.sourceUrl?.trim() || "未知"}
来源受众先验：${sourcePrior(profile)}
程序测量：正文 ${metrics.wordCount} 词，${metrics.sentenceCount} 句，平均句长 ${metrics.averageSentenceLength} 词，九字母以上长词比例 ${Math.round(metrics.longWordRatio * 100)}%，复杂句信号比例 ${Math.round(metrics.complexSentenceRatio * 100)}%，前 600 词词汇多样度 ${metrics.lexicalDiversity}。

判断顺序：
1. 估计正文实词在 A2及以下、B1、B2、C1及以上四档的覆盖百分比，总和为100。
2. 同时考虑句法、篇章抽象度、隐含背景知识、专业术语与修辞。
3. 国外普通网站面向一般读者的原生文章通常至少是高中/CET-4，更常见为 CET-6/考研或以上。只有明确面向青少年、英语学习者或考试学习者，且语言证据充分时，才可判为小学高年级或初中。
4. difficulty 是给中国学习者看的主标签，cefr 是辅助参照，两者必须相互一致。

可用 difficulty：${ARTICLE_DIFFICULTIES.join("、")}
可用 cefr：${ARTICLE_CEFR_LEVELS.join("、")}
可用 audienceStages：${ARTICLE_AUDIENCE_STAGES.join("、")}
可用 topics：${ARTICLE_TOPICS.join("、")}
timeliness 只能是 evergreen 或 time-sensitive。旧文章不等于过时，只有内容依赖当前日期、政策、价格、任职者或近期事件时才标为 time-sensitive。

只返回 JSON，字段：
- summary：45到100个中文字符，具体说明文章讲什么
- difficulty、cefr、audienceStages（1到4项，可同时覆盖 CET-6、考研、IELTS、TOEFL）、topics（1到3项）、timeliness
- vocabularyProfile：对象，含 a2OrBelow、b1、b2、c1OrAbove 四个整数百分比
- abstractness：1到5
- backgroundKnowledge：1到5
- challengingTerms：3到8个正文中的代表性难词或术语
- confidence：low、medium、high
- rationale：不超过100个中文字符，说明为什么是这个等级
- reviewNotes：不超过80个中文字符，只写发布前真正需要人工检查的事项，没有则空字符串

标题：${title.trim()}
正文：${compactModelText(text)}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.15,
        max_tokens: 900,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const payload = await response.json().catch(() => null) as DeepSeekClassificationResponse | null;
    if (!response.ok) {
      throw new Error(payload?.error?.message || `DeepSeek ${response.status}`);
    }
    const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content ?? "");
    if (!parsed) {
      throw new Error("模型没有返回合法 JSON");
    }

    let difficulty = allowedValue(parsed.difficulty, ARTICLE_DIFFICULTIES, fallback.difficulty);
    if ((profile === "general" || profile === "unknown") && (difficulty === "小学高年级" || difficulty === "初中")) {
      difficulty = "高中 / CET-4";
    }
    const cefr = cefrForDifficulty(difficulty);
    const audienceStages = [...new Set([
      ...allowedValues(parsed.audienceStages, ARTICLE_AUDIENCE_STAGES, audienceForDifficulty(difficulty)),
      ...audienceForDifficulty(difficulty),
    ])].slice(0, 4);
    const topics = allowedValues(parsed.topics, ARTICLE_TOPICS, fallback.topics).slice(0, 3);
    const timeliness = parsed.timeliness === "time-sensitive" ? "time-sensitive" : "evergreen";
    const summary = typeof parsed.summary === "string" && parsed.summary.trim().length >= 12
      ? parsed.summary.trim().slice(0, 220)
      : fallback.summary;
    const reviewNotes = typeof parsed.reviewNotes === "string" ? parsed.reviewNotes.trim().slice(0, 180) : "";
    const confidence = parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim().slice(0, 220)
      : "综合词汇覆盖、句法复杂度、篇章抽象度、背景知识和来源受众判断。";
    const estimatedVocabularyProfile = vocabularyProfile(parsed.vocabularyProfile);
    const evidence: ArticleDifficultyEvidence = {
      ...metrics,
      sourceProfile: profile,
      sourcePrior: sourcePrior(profile),
      ...(estimatedVocabularyProfile ? { vocabularyProfile: estimatedVocabularyProfile } : {}),
      abstractness: boundedNumber(parsed.abstractness, 1, 5, fallback.difficultyEvidence.abstractness),
      backgroundKnowledge: boundedNumber(parsed.backgroundKnowledge, 1, 5, fallback.difficultyEvidence.backgroundKnowledge),
      challengingTerms: challengingTerms(parsed.challengingTerms),
      confidence,
      rationale,
    };

    await recordSystemUsageExecution({
      feature: "article_classification",
      route: context.usageRoute || "/api/admin/article-classification",
      provider: "deepseek",
      model,
      promptTokens: payload?.usage?.prompt_tokens,
      promptCacheHitTokens: payload?.usage?.prompt_cache_hit_tokens,
      promptCacheMissTokens: payload?.usage?.prompt_cache_miss_tokens,
      completionTokens: payload?.usage?.completion_tokens,
      estimatedCostMicrousd: estimateDeepSeekCostMicrousd(model, payload?.usage ?? {}),
      status: "succeeded",
    }).catch(() => undefined);

    return {
      summary,
      difficulty,
      cefr,
      audienceStages,
      topics,
      wordCount: countArticleEnglishWords(text),
      timeliness,
      reviewNotes,
      classificationSource: "model",
      classifiedAt: new Date().toISOString(),
      difficultyEvidence: evidence,
    };
  } catch (error) {
    console.warn("Article classification fell back to local rules", error);
    await recordSystemUsageExecution({
      feature: "article_classification",
      route: context.usageRoute || "/api/admin/article-classification",
      provider: "deepseek",
      model,
      status: "failed",
      errorCode: "classification_fallback",
    }).catch(() => undefined);
    return heuristicResult(title, text, context, "DeepSeek 判断失败，已自动改用本地多证据规则，请在发布前复核。");
  }
}
