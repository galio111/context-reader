const DEFAULT_OPENAI_OCR_MODEL = "gpt-4o-mini";
const DEFAULT_ZHIPU_OCR_MODEL = "glm-4.6v-flash";
const DEFAULT_ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

interface VisionOcrResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

type OcrProvider = "openai" | "zhipu";

interface OcrConfig {
  provider: OcrProvider;
  apiKey: string;
  model: string;
  endpoint: string;
}

interface ExtractImageTextOptions {
  dataUrl: string;
  mode: "upload" | "article-image";
}

export interface ImageLayoutWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineText: string;
}

export interface ImageLayoutResult {
  words: ImageLayoutWord[];
}

export function cleanOcrText(value: string): string {
  return value
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanJsonText(value: string): string {
  return value
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getOcrConfig(): OcrConfig | null {
  const requestedProvider = process.env.OCR_PROVIDER?.trim().toLowerCase();

  if (requestedProvider === "zhipu") {
    const apiKey = process.env.ZHIPU_API_KEY?.trim();
    return apiKey
      ? {
          provider: "zhipu",
          apiKey,
          model: process.env.ZHIPU_OCR_MODEL?.trim() || DEFAULT_ZHIPU_OCR_MODEL,
          endpoint: `${trimTrailingSlash(process.env.ZHIPU_BASE_URL?.trim() || DEFAULT_ZHIPU_BASE_URL)}/chat/completions`,
        }
      : null;
  }

  if (requestedProvider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    return apiKey
      ? {
          provider: "openai",
          apiKey,
          model: process.env.OPENAI_OCR_MODEL?.trim() || DEFAULT_OPENAI_OCR_MODEL,
          endpoint: "https://api.openai.com/v1/chat/completions",
        }
      : null;
  }

  const zhipuApiKey = process.env.ZHIPU_API_KEY?.trim();
  if (zhipuApiKey) {
    return {
      provider: "zhipu",
      apiKey: zhipuApiKey,
      model: process.env.ZHIPU_OCR_MODEL?.trim() || DEFAULT_ZHIPU_OCR_MODEL,
      endpoint: `${trimTrailingSlash(process.env.ZHIPU_BASE_URL?.trim() || DEFAULT_ZHIPU_BASE_URL)}/chat/completions`,
    };
  }

  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiApiKey) {
    return {
      provider: "openai",
      apiKey: openaiApiKey,
      model: process.env.OPENAI_OCR_MODEL?.trim() || DEFAULT_OPENAI_OCR_MODEL,
      endpoint: "https://api.openai.com/v1/chat/completions",
    };
  }

  return null;
}

function promptForMode(mode: ExtractImageTextOptions["mode"]) {
  if (mode === "article-image") {
    return {
      system:
        "You are an OCR engine for English reading images inside imported articles. Extract all readable English text in natural reading order. Preserve paragraphs and line breaks when helpful. Return only the extracted text. Do not translate, summarize, or explain.",
      user: "Extract every readable English sentence from this image. Keep article, chart, caption, and label text when it is useful for reading.",
    };
  }

  return {
    system:
      "You are an OCR engine for English reading screenshots. Extract all readable English text in natural reading order. Preserve paragraphs and line breaks when helpful. Return only the extracted text. Do not translate, summarize, or explain.",
    user: "Extract every readable English sentence from this image. Keep the article text only when possible.",
  };
}

function imageUrlForProvider(dataUrl: string, provider: OcrProvider): string {
  if (provider === "zhipu") {
    return dataUrl.replace(/^data:[^;]+;base64,/i, "");
  }
  return dataUrl;
}

export async function extractImageText({ dataUrl, mode }: ExtractImageTextOptions): Promise<string> {
  const config = getOcrConfig();
  if (!config) {
    throw new Error(mode === "article-image" ? "图片文字识别暂不可用。" : "OCR 识别暂不可用。");
  }

  const prompt = promptForMode(mode);
  const requestBody: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    max_tokens: 3000,
    stream: false,
    messages: [
      {
        role: "system",
        content: prompt.system,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt.user,
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrlForProvider(dataUrl, config.provider),
            },
          },
        ],
      },
    ],
  };

  if (config.provider === "zhipu") {
    requestBody.thinking = {
      type: "enabled",
    };
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30000),
  });

  const data = (await response.json().catch(() => null)) as VisionOcrResponse | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || (mode === "article-image" ? "图片文字识别失败，请稍后重试。" : "OCR 识别失败，请稍后重试。"));
  }

  const text = cleanOcrText(data?.choices?.[0]?.message?.content ?? "");
  if (!text) {
    throw new Error("没有从图片中识别到英文文本。");
  }

  return text;
}

function normalizePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return value <= 1000 ? Math.min(100, value / 10) : null;
  }
  return value;
}

function numericField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBox(rawBox: Record<string, unknown>): { x: number; y: number; width: number; height: number } | null {
  const bboxValue = rawBox.bbox ?? rawBox.box ?? rawBox.boundingBox;
  let x = numericField(rawBox.x);
  let y = numericField(rawBox.y);
  let width = numericField(rawBox.width ?? rawBox.w);
  let height = numericField(rawBox.height ?? rawBox.h);

  if (Array.isArray(bboxValue) && bboxValue.length >= 4) {
    x = numericField(bboxValue[0]);
    y = numericField(bboxValue[1]);
    width = numericField(bboxValue[2]);
    height = numericField(bboxValue[3]);
  } else if (bboxValue && typeof bboxValue === "object") {
    const bbox = bboxValue as Record<string, unknown>;
    x = numericField(bbox.x ?? bbox.left);
    y = numericField(bbox.y ?? bbox.top);
    width = numericField(bbox.width ?? bbox.w);
    height = numericField(bbox.height ?? bbox.h);

    const x1 = numericField(bbox.x1 ?? bbox.left);
    const y1 = numericField(bbox.y1 ?? bbox.top);
    const x2 = numericField(bbox.x2 ?? bbox.right);
    const y2 = numericField(bbox.y2 ?? bbox.bottom);
    if ((width === null || height === null) && x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      x = x1;
      y = y1;
      width = x2 - x1;
      height = y2 - y1;
    }
  }

  const rawValues = [x, y, width, height];
  if (rawValues.some((value) => value === null)) {
    return null;
  }
  const scale = rawValues.every((value) => typeof value === "number" && Math.abs(value) <= 1.5) ? 100 : 1;
  const normalizedX = normalizePercent((x as number) * scale);
  const normalizedY = normalizePercent((y as number) * scale);
  const normalizedWidth = normalizePercent((width as number) * scale);
  const normalizedHeight = normalizePercent((height as number) * scale);

  if (normalizedX === null || normalizedY === null || normalizedWidth === null || normalizedHeight === null) {
    return null;
  }
  return {
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function parseImageLayout(content: string): ImageLayoutResult {
  const cleaned = cleanJsonText(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("图片词框识别结果不是有效 JSON。");
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }

  const wordsValue = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { words?: unknown }).words)
      ? (parsed as { words: unknown[] }).words
      : [];

  const words = wordsValue
    .map((item): ImageLayoutWord | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as Record<string, unknown>;
      const text = typeof value.text === "string" ? value.text.trim() : "";
      const lineText = typeof value.lineText === "string" ? value.lineText.trim() : "";
      const box = normalizeBox(value);

      if (!text || !box || box.width <= 0 || box.height <= 0) {
        return null;
      }

      return {
        text,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        lineText: lineText || text,
      };
    })
    .filter((item): item is ImageLayoutWord => Boolean(item))
    .slice(0, 500);

  if (words.length === 0) {
    throw new Error("没有识别到可点击的英文词框。");
  }

  return { words };
}

export async function extractImageLayout(dataUrl: string): Promise<ImageLayoutResult> {
  const config = getOcrConfig();
  if (!config) {
    throw new Error("图片词框识别暂不可用。");
  }

  const requestBody: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    max_tokens: 6000,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "You are an OCR layout engine for English reading images. Return strict JSON only. Detect each readable English word and its bounding box as percentages of the full image, where x,y,width,height are numbers from 0 to 100. Use the visible word text exactly. Include lineText for the full line or sentence containing the word. Do not translate or explain.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              'Return JSON in this exact shape: {"words":[{"text":"word","x":0,"y":0,"width":1,"height":1,"lineText":"full visible line"}]}. Keep only English words. Coordinates must be percentages relative to the original image.',
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrlForProvider(dataUrl, config.provider),
            },
          },
        ],
      },
    ],
  };

  if (config.provider === "zhipu") {
    requestBody.thinking = {
      type: "enabled",
    };
  } else {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(45000),
  });

  const data = (await response.json().catch(() => null)) as VisionOcrResponse | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || "图片词框识别失败，请稍后重试。");
  }

  return parseImageLayout(data?.choices?.[0]?.message?.content ?? "");
}
