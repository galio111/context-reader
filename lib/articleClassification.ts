import {
  ARTICLE_AUDIENCE_STAGES,
  ARTICLE_CEFR_LEVELS,
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleAudienceStage,
  type ArticleCefrLevel,
  type ArticleDifficulty,
  type ArticleTimeliness,
  type ArticleTopic,
} from "@/types/publicArticle";

const DEFAULT_MODEL = "deepseek-v4-pro";
const MAX_MODEL_TEXT_CHARS = 18_000;

interface DeepSeekClassificationResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface ArticleClassificationResult {
  summary: string;
  difficulty: ArticleDifficulty;
  cefr: ArticleCefrLevel;
  audienceStages: ArticleAudienceStage[];
  topics: ArticleTopic[];
  readingMinutes: number;
  timeliness: ArticleTimeliness;
  reviewNotes: string;
  classificationSource: "model" | "heuristic";
  classifiedAt: string;
  warning?: string;
}

function articleWords(text: string): string[] {
  return text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
}

function readingMinutesFor(text: string): number {
  return Math.max(1, Math.ceil(articleWords(text).length / 180));
}

function summaryFallback(title: string): string {
  const cleanTitle = title.trim() || "这篇文章";
  return `围绕“${cleanTitle}”展开的英文阅读文章，可在阅读过程中进行语境查词和短语理解。`;
}

function heuristicDifficulty(text: string): { difficulty: ArticleDifficulty; cefr: ArticleCefrLevel } {
  const words = articleWords(text);
  const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  const averageSentenceLength = words.length / Math.max(1, sentences.length);
  const complexWordRatio = words.filter((word) => word.replace(/[^A-Za-z]/g, "").length >= 9).length / Math.max(1, words.length);

  if (averageSentenceLength <= 11 && complexWordRatio < 0.08) {
    return { difficulty: "小学高年级", cefr: "A2" };
  }
  if (averageSentenceLength <= 15 && complexWordRatio < 0.12) {
    return { difficulty: "初中", cefr: "B1" };
  }
  if (averageSentenceLength <= 20 && complexWordRatio < 0.17) {
    return { difficulty: "高中 / CET-4", cefr: "B2" };
  }
  if (averageSentenceLength <= 25 && complexWordRatio < 0.22) {
    return { difficulty: "CET-6 / 考研", cefr: "C1" };
  }
  if (averageSentenceLength <= 31 && complexWordRatio < 0.28) {
    return { difficulty: "雅思 / 托福基础", cefr: "C1" };
  }
  return { difficulty: "雅思 / 托福进阶", cefr: "C2" };
}

function audienceForDifficulty(difficulty: ArticleDifficulty): ArticleAudienceStage[] {
  const mapping: Record<ArticleDifficulty, ArticleAudienceStage[]> = {
    小学高年级: ["小学"],
    初中: ["初中"],
    "高中 / CET-4": ["高中", "CET-4"],
    "CET-6 / 考研": ["CET-6", "考研"],
    "雅思 / 托福基础": ["IELTS", "TOEFL"],
    "雅思 / 托福进阶": ["IELTS", "TOEFL"],
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

function heuristicResult(title: string, text: string, warning?: string): ArticleClassificationResult {
  const { difficulty, cefr } = heuristicDifficulty(text);
  return {
    summary: summaryFallback(title),
    difficulty,
    cefr,
    audienceStages: audienceForDifficulty(difficulty),
    topics: heuristicTopics(title, text),
    readingMinutes: readingMinutesFor(text),
    timeliness: heuristicTimeliness(text),
    reviewNotes: "已按句长和词汇复杂度完成基础判断，发布前可手动调整。",
    classificationSource: "heuristic",
    classifiedAt: new Date().toISOString(),
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

export async function classifyArticle(title: string, text: string): Promise<ArticleClassificationResult> {
  const fallback = heuristicResult(title, text);
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return heuristicResult(title, text, "未配置 DeepSeek，当前使用本地难度与主题规则。" );
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const prompt = `你是面向中国英语学习者的英文文章编辑。根据文章内容返回一个 JSON 对象，不要返回 Markdown。\n\n可用 difficulty：${ARTICLE_DIFFICULTIES.join("、")}\n可用 cefr：${ARTICLE_CEFR_LEVELS.join("、")}\n可用 audienceStages：${ARTICLE_AUDIENCE_STAGES.join("、")}\n可用 topics：${ARTICLE_TOPICS.join("、")}\ntimeliness 只能是 evergreen 或 time-sensitive。旧文章不等于过时，只有内容依赖当前日期、政策、价格、任职者或近期事件时才标为 time-sensitive。\n\n返回字段：summary（45 到 100 个中文字符，具体说明文章讲什么）、difficulty、cefr、audienceStages（1 到 3 项）、topics（1 到 3 项）、timeliness、reviewNotes（不超过 80 个中文字符，指出发布前真正需要检查的事项，没有就写空字符串）。\n\n标题：${title.trim()}\n正文：${compactModelText(text)}`;

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
        max_tokens: 650,
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

    const difficulty = allowedValue(parsed.difficulty, ARTICLE_DIFFICULTIES, fallback.difficulty);
    const cefr = allowedValue(parsed.cefr, ARTICLE_CEFR_LEVELS, fallback.cefr);
    const audienceStages = allowedValues(parsed.audienceStages, ARTICLE_AUDIENCE_STAGES, audienceForDifficulty(difficulty));
    const topics = allowedValues(parsed.topics, ARTICLE_TOPICS, fallback.topics).slice(0, 3);
    const timeliness = parsed.timeliness === "time-sensitive" ? "time-sensitive" : "evergreen";
    const summary = typeof parsed.summary === "string" && parsed.summary.trim().length >= 12
      ? parsed.summary.trim().slice(0, 220)
      : fallback.summary;
    const reviewNotes = typeof parsed.reviewNotes === "string" ? parsed.reviewNotes.trim().slice(0, 180) : "";

    return {
      summary,
      difficulty,
      cefr,
      audienceStages: audienceStages.slice(0, 3),
      topics,
      readingMinutes: readingMinutesFor(text),
      timeliness,
      reviewNotes,
      classificationSource: "model",
      classifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("Article classification fell back to local rules", error);
    return heuristicResult(title, text, "DeepSeek 判断失败，已自动改用本地规则，请在发布前复核。" );
  }
}
