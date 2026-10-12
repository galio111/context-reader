import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

const MAX_RETRY_ATTEMPTS = 8;
const MAX_CONSECUTIVE_ZERO_PROGRESS_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 30_000;
export const FALLBACK_ERROR = "全文翻译生成失败，请稍后重试。";

export interface TranslationApiResponse {
  translations?: ArticleTranslationItem[];
  error?: string;
  code?: string;
}

function waitForRetry(
  signal: AbortSignal,
  delayMs: number,
  onCountdown: (remainingSeconds: number) => void,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + delayMs;
    const updateCountdown = () => onCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    updateCountdown();
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const interval = window.setInterval(updateCountdown, 1_000);
    const cleanup = () => {
      window.clearInterval(interval);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestArticleTranslation(
  blocks: ArticleTranslationBlock[],
  signal: AbortSignal,
  contextBlocks: ArticleTranslationBlock[],
  actionId: string,
  onRetry: (delaySeconds: number, reason: string) => void,
  onTranslation: (translation: ArticleTranslationItem) => void,
): Promise<ArticleTranslationItem[]> {
  const collected = new Map<string, ArticleTranslationItem>();
  let consecutiveZeroProgressAttempts = 0;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const pendingBlocks = blocks.filter((block) => !collected.has(block.id));
    if (!pendingBlocks.length) return blocks.map((block) => collected.get(block.id)!).filter(Boolean);
    const collectedBeforeAttempt = collected.size;
    let response: Response;
    try {
      response = await fetch("/api/translate-article", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-context-translation-action-id": actionId,
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ blocks: pendingBlocks, contextBlocks }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || attempt === MAX_RETRY_ATTEMPTS) {
        throw error;
      }
      const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
      const retryReason = "网络连接暂时中断，正在等待恢复。";
      await waitForRetry(signal, delayMs, (remainingSeconds) => onRetry(remainingSeconds, retryReason));
      continue;
    }

    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: TranslationApiResponse | null = null;
      const consumeLine = (line: string) => {
          if (!line.trim()) return;
          let event: { type?: string; translation?: ArticleTranslationItem; error?: string; code?: string };
          try { event = JSON.parse(line); }
          catch { streamError = { error: "翻译流数据不完整。", code: "provider_temporary" }; return; }
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (event.type === "translation" && event.translation?.id && event.translation.translation?.trim()) {
            if (!collected.has(event.translation.id)) {
              collected.set(event.translation.id, event.translation);
              onTranslation(event.translation);
            }
          } else if (event.type === "error") {
            streamError = { error: event.error, code: event.code };
          }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) consumeLine(line);
          if (done) { consumeLine(buffer); break; }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        streamError = { error: "翻译流连接中断。", code: "provider_temporary" };
      } finally {
        reader.releaseLock();
      }
      if (!streamError && blocks.every((block) => collected.has(block.id))) {
        return blocks.map((block) => collected.get(block.id)!).filter(Boolean);
      }
      streamError ??= { error: "AI 服务没有返回完整译文。", code: "provider_temporary" };
      if (streamError) {
        consecutiveZeroProgressAttempts = collected.size > collectedBeforeAttempt
          ? 0
          : consecutiveZeroProgressAttempts + 1;
        if (consecutiveZeroProgressAttempts >= MAX_CONSECUTIVE_ZERO_PROGRESS_ATTEMPTS) {
          throw new Error("AI 服务连续未返回可显示译文，请点击重试。");
        }
        if (attempt === MAX_RETRY_ATTEMPTS) throw new Error(streamError.error || FALLBACK_ERROR);
        const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
        const retryReason = "AI 翻译流短暂中断，正在续传未完成段落。";
        await waitForRetry(signal, delayMs, (remainingSeconds) => onRetry(remainingSeconds, retryReason));
        continue;
      }
    }

    const data = await response.json().catch(() => null) as TranslationApiResponse | null;

    const message = data?.error || FALLBACK_ERROR;
    const canRetry =
      data?.code === "provider_rate_limit" ||
      data?.code === "provider_temporary" ||
      data?.code === "local_concurrency" ||
      data?.code === "site_rate_limit" ||
      response.status === 429 ||
      (response.status === 503 && data?.code !== "account_not_configured");
    if (!canRetry || attempt === MAX_RETRY_ATTEMPTS) throw new Error(message);

    const retryAfter = Number(response.headers.get("Retry-After"));
    const delayMs = Math.min(
      RETRY_MAX_DELAY_MS,
      Math.max(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 0,
        RETRY_BASE_DELAY_MS * 2 ** attempt,
      ),
    );
    const retryReason = data?.code === "site_rate_limit" || response.status === 429
      ? "本站正在平稳提交后续段落，避免瞬时请求过多。"
      : data?.code === "provider_rate_limit"
        ? "AI 翻译服务暂时限流，正在等待可用通道。"
        : data?.code === "local_concurrency"
          ? "当前有其他翻译任务，正在等待处理位置。"
          : "AI 翻译服务短暂波动，正在等待恢复。";
    await waitForRetry(signal, delayMs, (remainingSeconds) => onRetry(remainingSeconds, retryReason));
  }
  throw new Error(FALLBACK_ERROR);
}

