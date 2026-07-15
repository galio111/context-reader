import { fetchJson } from "@/lib/apiClient";
import type { WordContext, WordExplanation } from "@/types/reader";

function requestBody(context: WordContext) {
  return JSON.stringify({
    word: context.word,
    sentence: context.sentence,
    previousSentence: context.previousSentence,
    nextSentence: context.nextSentence,
  });
}

export async function requestContextExplanation(
  context: WordContext,
  signal: AbortSignal,
  actionId: string,
): Promise<WordExplanation> {
  const { response, data } = await fetchJson<{ explanation?: WordExplanation; error?: string }>(
    "/api/explain-word",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-context-action-id": actionId,
      },
      body: requestBody(context),
      signal,
    },
    "解释失败，请稍后重试。",
  );

  if (!response.ok) {
    throw new Error(data?.error || "解释失败，请稍后重试。");
  }

  if (!data?.explanation?.anki) {
    throw new Error("解释结果缺少学习字段，请重新选择这个词。");
  }

  return data.explanation;
}

export async function requestContextExplanationStream(
  context: WordContext,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  actionId: string,
): Promise<string> {
  let response: Response;

  try {
    response = await fetch("/api/explain-word-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-context-action-id": actionId,
      },
      body: requestBody(context),
      signal,
    });
  } catch {
    return "";
  }

  if (!response.ok || !response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      fullText += chunk;
      onChunk(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
