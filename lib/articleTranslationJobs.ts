"use client";

import {
  setCachedArticleTranslation,
  setCachedArticleTranslationForBlocks,
} from "@/lib/cache";
import { fetchJson } from "@/lib/apiClient";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";
import { createArticleTranslationBatches } from "@/lib/articleTranslationBatching";

const MAX_RETRY_ATTEMPTS = 8;
const MAX_CONSECUTIVE_ZERO_PROGRESS_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 30_000;
const FALLBACK_ERROR = "全文翻译生成失败，请稍后重试。";

interface TranslationApiResponse {
  translations?: ArticleTranslationItem[];
  error?: string;
  code?: string;
}

interface TranslationStartResponse extends TranslationApiResponse {
  actionId?: string;
  source?: "generated" | "public_cache";
  translations?: ArticleTranslationItem[];
}

export interface ArticleTranslationJobSnapshot {
  translations: ArticleTranslationItem[];
  loading: boolean;
  error: string;
  requested: boolean;
  estimatedSecondsRemaining: number | null;
  retryAfterSeconds: number | null;
  retryReason: string | null;
  regenerating: boolean;
  completedTargetBlocks: number;
  totalTargetBlocks: number;
}

type ArticleTranslationJobListener = (snapshot: ArticleTranslationJobSnapshot) => void;

interface ArticleTranslationJob extends ArticleTranslationJobSnapshot {
  controller: AbortController;
  actionId: string;
  startedAt: number;
  totalBlocks: number;
}

const jobs = new Map<string, ArticleTranslationJob>();
const listeners = new Map<string, Set<ArticleTranslationJobListener>>();

function snapshotJob(job: ArticleTranslationJob): ArticleTranslationJobSnapshot {
  return {
    translations: job.translations,
    loading: job.loading,
    error: job.error,
    requested: job.requested,
    estimatedSecondsRemaining: job.estimatedSecondsRemaining,
    retryAfterSeconds: job.retryAfterSeconds,
    retryReason: job.retryReason,
    regenerating: job.regenerating,
    completedTargetBlocks: job.completedTargetBlocks,
    totalTargetBlocks: job.totalTargetBlocks,
  };
}

function notifyJob(key: string): void {
  const job = jobs.get(key);
  if (!job) return;
  const snapshot = snapshotJob(job);
  listeners.get(key)?.forEach((listener) => listener(snapshot));
}

function waitForRetry(
  signal: AbortSignal,
  delayMs: number,
  onCountdown: (remainingSeconds: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + delayMs;
    const updateCountdown = () => onCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    updateCountdown();
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

async function requestArticleTranslation(
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
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = done ? "" : lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type?: string; translation?: ArticleTranslationItem; error?: string; code?: string };
          if (event.type === "translation" && event.translation?.id && event.translation.translation?.trim()) {
            if (!collected.has(event.translation.id)) {
              collected.set(event.translation.id, event.translation);
              onTranslation(event.translation);
            }
          } else if (event.type === "error") {
            streamError = { error: event.error, code: event.code };
          }
        }
        if (done) break;
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

async function startTranslationUsage(
  actionId: string,
  cacheKey: string,
  blocks: ArticleTranslationBlock[],
  source: "generated" | "public_cache",
  publicArticleId?: string,
): Promise<TranslationStartResponse> {
  const { response, data } = await fetchJson<TranslationStartResponse>("/api/translate-article/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actionId,
      cacheKey,
      source,
      publicArticleId,
      articleCharacters: blocks.reduce((sum, block) => sum + block.text.length, 0),
      blockCount: blocks.length,
    }),
  }, "全文翻译次数校验失败，请稍后重试。", { operation: "article_translation_start" });
  if (!response.ok || !data?.actionId) throw new Error(data?.error || "全文翻译次数校验失败，请稍后重试。");
  return data;
}

async function finishTranslationUsage(actionId: string, status: "succeeded" | "failed" | "cancelled"): Promise<void> {
  await fetch("/api/translate-article/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, status }),
    keepalive: status !== "succeeded",
  }).catch(() => undefined);
}

export function getArticleTranslationJobSnapshot(key: string): ArticleTranslationJobSnapshot | null {
  const job = jobs.get(key);
  return job ? snapshotJob(job) : null;
}

export function subscribeArticleTranslationJob(key: string, listener: ArticleTranslationJobListener): () => void {
  const keyListeners = listeners.get(key) ?? new Set<ArticleTranslationJobListener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
}

export async function startArticleTranslationJob(
  key: string,
  blocks: ArticleTranslationBlock[],
  options: {
    force?: boolean;
    initialTranslations?: ArticleTranslationItem[];
    allBlocks?: ArticleTranslationBlock[];
    publicCache?: { articleId: string };
    publicArticleId?: string;
  } = {},
): Promise<void> {
  const existingJob = jobs.get(key);
  if (existingJob?.loading && !options.force) return;
  if (existingJob && !existingJob.loading && !existingJob.error && existingJob.translations.length > 0 && !options.force) return;
  if (existingJob?.loading) {
    existingJob.controller.abort();
    void finishTranslationUsage(existingJob.actionId, "cancelled");
  }

  const controller = new AbortController();
  let actionId = crypto.randomUUID();
  const initialTranslations = options.initialTranslations ?? [];
  const job: ArticleTranslationJob = {
    controller,
    actionId,
    translations: initialTranslations,
    loading: true,
    error: "",
    requested: true,
    estimatedSecondsRemaining: null,
    retryAfterSeconds: null,
    retryReason: null,
    regenerating: Boolean(options.force),
    completedTargetBlocks: 0,
    totalTargetBlocks: blocks.length,
    startedAt: Date.now(),
    totalBlocks: blocks.length,
  };
  jobs.set(key, job);
  notifyJob(key);

  try {
    const allBlocks = options.allBlocks ?? blocks;
    const start = await startTranslationUsage(
      actionId,
      key,
      allBlocks,
      options.publicCache ? "public_cache" : "generated",
      options.publicCache?.articleId ?? options.publicArticleId,
    );
    actionId = start.actionId ?? actionId;
    job.actionId = actionId;

    if (options.publicCache) {
      const available = new Map((start.translations ?? []).map((item) => [item.id, item]));
      const ordered = allBlocks.map((block) => available.get(block.id)).filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
      if (ordered.length !== allBlocks.length) throw new Error("精选文章的预发布译文不完整，请联系管理员更新。");
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const revealed: ArticleTranslationItem[] = [];
      for (const translation of ordered) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        revealed.push(translation);
        job.translations = [...revealed];
        job.completedTargetBlocks = revealed.length;
        job.estimatedSecondsRemaining = 0;
        notifyJob(key);
        if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 45));
      }
      job.loading = false;
      job.error = "";
      setCachedArticleTranslation(key, ordered);
      setCachedArticleTranslationForBlocks(allBlocks, ordered);
      notifyJob(key);
      return;
    }

    const mergedTranslations: ArticleTranslationItem[] = [...initialTranslations];
    const completedTargetIds = new Set<string>();
    for (const batch of createArticleTranslationBatches(blocks)) {
      await requestArticleTranslation(batch, controller.signal, allBlocks, actionId, (delaySeconds, reason) => {
        job.retryAfterSeconds = delaySeconds;
        job.retryReason = reason;
        notifyJob(key);
      }, (translation) => {
        job.retryAfterSeconds = null;
        job.retryReason = null;
        const existingIndex = mergedTranslations.findIndex((item) => item.id === translation.id);
        if (existingIndex >= 0) mergedTranslations.splice(existingIndex, 1);
        mergedTranslations.push(translation);
        completedTargetIds.add(translation.id);
        const mergedById = new Map(mergedTranslations.map((item) => [item.id, item]));
        job.translations = allBlocks.map((block) => mergedById.get(block.id)).filter((item): item is ArticleTranslationItem => Boolean(item));
        job.completedTargetBlocks = completedTargetIds.size;
        setCachedArticleTranslation(key, job.translations);
        setCachedArticleTranslationForBlocks(allBlocks, [translation]);
        const completedBlocks = Math.max(1, job.completedTargetBlocks);
        const remainingBlocks = Math.max(0, job.totalBlocks - job.completedTargetBlocks);
        const elapsedSeconds = Math.max(1, (Date.now() - job.startedAt) / 1_000);
        job.estimatedSecondsRemaining = remainingBlocks > 0 ? Math.ceil((elapsedSeconds / completedBlocks) * remainingBlocks) : 0;
        notifyJob(key);
      });
    }
    job.loading = false;
    job.error = "";
    job.estimatedSecondsRemaining = 0;
    job.retryAfterSeconds = null;
    job.retryReason = null;
    setCachedArticleTranslation(key, job.translations);
    setCachedArticleTranslationForBlocks(allBlocks, job.translations);
    await finishTranslationUsage(actionId, "succeeded");
    notifyJob(key);
  } catch (translationRequestError) {
    if (controller.signal.aborted) return;
    await finishTranslationUsage(actionId, "failed");
    job.loading = false;
    job.retryAfterSeconds = null;
    job.retryReason = null;
    job.error = translationRequestError instanceof Error ? translationRequestError.message : FALLBACK_ERROR;
    if (job.translations.length > 0) {
      setCachedArticleTranslation(key, job.translations);
      setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, job.translations);
    }
    notifyJob(key);
  }
}
