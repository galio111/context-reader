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

export function cleanOcrText(value: string): string {
  return value
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
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
