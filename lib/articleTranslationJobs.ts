"use client";

import {
  removeCachedArticleTranslation,
  removeCachedArticleTranslationForBlocks,
  setCachedArticleTranslation,
  setCachedArticleTranslationForBlocks,
} from "@/lib/cache";
import { fetchJson } from "@/lib/apiClient";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

const TRANSLATION_BATCH_MAX_BLOCKS = 1;
const TRANSLATION_BATCH_MAX_CHARS = 1800;
const MAX_RETRY_ATTEMPTS = 8;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 30_000;
const FALLBACK_ERROR = "全文翻译生成失败，请稍后重试。";

interface TranslationApiResponse {
  translations?: ArticleTranslationItem[];
  error?: string;
  code?: string;
}

export interface ArticleTranslationJobSnapshot {
  translations: ArticleTranslationItem[];
  loading: boolean;
  error: string;
  requested: boolean;
  estimatedSecondsRemaining: number | null;
  retryAfterSeconds: number | null;
}

type ArticleTranslationJobListener = (snapshot: ArticleTranslationJobSnapshot) => void;

interface ArticleTranslationJob extends ArticleTranslationJobSnapshot {
  controller: AbortController;
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
  };
}

function notifyJob(key: string): void {
  const job = jobs.get(key);
  if (!job) return;
  const snapshot = snapshotJob(job);
  listeners.get(key)?.forEach((listener) => listener(snapshot));
}

function waitForRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestArticleTranslation(
  blocks: ArticleTranslationBlock[],
  signal: AbortSignal,
  contextBlocks: ArticleTranslationBlock[],
  onRetry: (delaySeconds: number) => void,
): Promise<ArticleTranslationItem[]> {
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    let response: Response;
    let data: TranslationApiResponse | null;
    try {
      const result = await fetchJson<TranslationApiResponse>("/api/translate-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks, contextBlocks }),
        signal,
      }, FALLBACK_ERROR, {
        operation: "article_translation",
        metadata: {
          blockCount: blocks.length,
          contextBlockCount: contextBlocks.length,
          characters: blocks.reduce((sum, block) => sum + block.text.length, 0),
        },
      });
      response = result.response;
      data = result.data;
    } catch (error) {
      if (signal.aborted || attempt === MAX_RETRY_ATTEMPTS) {
        throw error;
      }
      const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
      onRetry(Math.ceil(delayMs / 1_000));
      await waitForRetry(signal, delayMs);
      continue;
    }

    if (response.ok && Array.isArray(data?.translations)) return data.translations;

    const message = data?.error || FALLBACK_ERROR;
    const canRetry =
      data?.code === "provider_rate_limit" ||
      data?.code === "provider_temporary" ||
      data?.code === "local_concurrency" ||
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
    onRetry(Math.ceil(delayMs / 1_000));
    await waitForRetry(signal, delayMs);
  }
  throw new Error(FALLBACK_ERROR);
}

function createTranslationBatches(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[][] {
  const batches: ArticleTranslationBlock[][] = [];
  let currentBatch: ArticleTranslationBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    const shouldStartNextBatch = currentBatch.length > 0 &&
      (currentBatch.length >= TRANSLATION_BATCH_MAX_BLOCKS || currentChars + block.text.length > TRANSLATION_BATCH_MAX_CHARS);
    if (shouldStartNextBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(block);
    currentChars += block.text.length;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
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
  options: { force?: boolean; initialTranslations?: ArticleTranslationItem[]; allBlocks?: ArticleTranslationBlock[] } = {},
): Promise<void> {
  const existingJob = jobs.get(key);
  if (existingJob?.loading && !options.force) return;
  if (existingJob && !existingJob.loading && !existingJob.error && existingJob.translations.length > 0 && !options.force) return;
  if (existingJob?.loading) existingJob.controller.abort();

  const controller = new AbortController();
  const initialTranslations = options.initialTranslations ?? [];
  if (options.force) {
    removeCachedArticleTranslation(key);
    removeCachedArticleTranslationForBlocks(options.allBlocks ?? blocks);
  }
  const job: ArticleTranslationJob = {
    controller,
    translations: initialTranslations,
    loading: true,
    error: "",
    requested: true,
    estimatedSecondsRemaining: null,
    retryAfterSeconds: null,
    startedAt: Date.now(),
    totalBlocks: initialTranslations.length + blocks.length,
  };
  jobs.set(key, job);
  notifyJob(key);

  try {
    const mergedTranslations: ArticleTranslationItem[] = [...initialTranslations];
    for (const batch of createTranslationBatches(blocks)) {
      const translations = await requestArticleTranslation(batch, controller.signal, options.allBlocks ?? blocks, (delaySeconds) => {
        job.retryAfterSeconds = delaySeconds;
        notifyJob(key);
      });
      job.retryAfterSeconds = null;
      const translatedIds = new Set(translations.map((item) => item.id));
      for (let index = mergedTranslations.length - 1; index >= 0; index -= 1) {
        if (translatedIds.has(mergedTranslations[index].id)) mergedTranslations.splice(index, 1);
      }
      mergedTranslations.push(...translations);
      job.translations = [...mergedTranslations];
      setCachedArticleTranslation(key, job.translations);
      setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, translations);
      const completedBlocks = Math.max(1, job.translations.length);
      const remainingBlocks = Math.max(0, job.totalBlocks - completedBlocks);
      const elapsedSeconds = Math.max(1, (Date.now() - job.startedAt) / 1_000);
      job.estimatedSecondsRemaining = remainingBlocks > 0 ? Math.ceil((elapsedSeconds / completedBlocks) * remainingBlocks) : 0;
      notifyJob(key);
    }
    job.loading = false;
    job.error = "";
    job.estimatedSecondsRemaining = 0;
    job.retryAfterSeconds = null;
    setCachedArticleTranslation(key, mergedTranslations);
    setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, mergedTranslations);
    notifyJob(key);
  } catch (translationRequestError) {
    if (controller.signal.aborted) return;
    job.loading = false;
    job.retryAfterSeconds = null;
    job.error = translationRequestError instanceof Error ? translationRequestError.message : FALLBACK_ERROR;
    if (job.translations.length > 0) {
      setCachedArticleTranslation(key, job.translations);
      setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, job.translations);
    }
    notifyJob(key);
  }
}
