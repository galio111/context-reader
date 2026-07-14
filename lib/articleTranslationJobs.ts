"use client";

import { setCachedArticleTranslation, setCachedArticleTranslationForBlocks } from "@/lib/cache";
import { fetchJson } from "@/lib/apiClient";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

const TRANSLATION_BATCH_MAX_BLOCKS = 1;
const TRANSLATION_BATCH_MAX_CHARS = 1800;

export interface ArticleTranslationJobSnapshot {
  translations: ArticleTranslationItem[];
  loading: boolean;
  error: string;
  requested: boolean;
  estimatedSecondsRemaining: number | null;
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
  };
}

function notifyJob(key: string): void {
  const job = jobs.get(key);
  if (!job) {
    return;
  }

  const snapshot = snapshotJob(job);
  listeners.get(key)?.forEach((listener) => listener(snapshot));
}

async function requestArticleTranslation(
  blocks: ArticleTranslationBlock[],
  signal: AbortSignal,
  contextBlocks: ArticleTranslationBlock[],
): Promise<ArticleTranslationItem[]> {
  const { response, data } = await fetchJson<{ translations?: ArticleTranslationItem[]; error?: string }>("/api/translate-article", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ blocks, contextBlocks }),
    signal,
  }, "全文翻译生成失败，请稍后重试。");

  if (!response.ok || !Array.isArray(data?.translations)) {
    throw new Error(data?.error || "全文翻译生成失败，请稍后重试。");
  }

  return data.translations;
}

function createTranslationBatches(blocks: ArticleTranslationBlock[]): ArticleTranslationBlock[][] {
  const batches: ArticleTranslationBlock[][] = [];
  let currentBatch: ArticleTranslationBlock[] = [];
  let currentChars = 0;

  for (const block of blocks) {
    const shouldStartNextBatch =
      currentBatch.length > 0 &&
      (currentBatch.length >= TRANSLATION_BATCH_MAX_BLOCKS ||
        currentChars + block.text.length > TRANSLATION_BATCH_MAX_CHARS);

    if (shouldStartNextBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(block);
    currentChars += block.text.length;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export function getArticleTranslationJobSnapshot(key: string): ArticleTranslationJobSnapshot | null {
  const job = jobs.get(key);
  return job ? snapshotJob(job) : null;
}

export function subscribeArticleTranslationJob(
  key: string,
  listener: ArticleTranslationJobListener,
): () => void {
  const keyListeners = listeners.get(key) ?? new Set<ArticleTranslationJobListener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);

  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) {
      listeners.delete(key);
    }
  };
}

export async function startArticleTranslationJob(
  key: string,
  blocks: ArticleTranslationBlock[],
  options: { force?: boolean; initialTranslations?: ArticleTranslationItem[]; allBlocks?: ArticleTranslationBlock[] } = {},
): Promise<void> {
  const existingJob = jobs.get(key);
  if (existingJob?.loading && !options.force) {
    return;
  }
  if (existingJob && !existingJob.loading && !existingJob.error && existingJob.translations.length > 0 && !options.force) {
    return;
  }

  if (existingJob?.loading) {
    existingJob.controller.abort();
  }

  const controller = new AbortController();
  const initialTranslations = options.initialTranslations ?? [];
  const job: ArticleTranslationJob = {
    controller,
    translations: initialTranslations,
    loading: true,
    error: "",
    requested: true,
    estimatedSecondsRemaining: null,
    startedAt: Date.now(),
    totalBlocks: initialTranslations.length + blocks.length,
  };
  jobs.set(key, job);
  notifyJob(key);

  try {
    const mergedTranslations: ArticleTranslationItem[] = [...initialTranslations];

    for (const batch of createTranslationBatches(blocks)) {
      const translations = await requestArticleTranslation(batch, controller.signal, options.allBlocks ?? blocks);
      const translatedIds = new Set(translations.map((item) => item.id));
      for (let index = mergedTranslations.length - 1; index >= 0; index -= 1) {
        if (translatedIds.has(mergedTranslations[index].id)) {
          mergedTranslations.splice(index, 1);
        }
      }
      mergedTranslations.push(...translations);
      job.translations = [...mergedTranslations];
      const completedBlocks = Math.max(1, job.translations.length);
      const remainingBlocks = Math.max(0, job.totalBlocks - completedBlocks);
      const elapsedSeconds = Math.max(1, (Date.now() - job.startedAt) / 1000);
      job.estimatedSecondsRemaining =
        remainingBlocks > 0 ? Math.ceil((elapsedSeconds / completedBlocks) * remainingBlocks) : 0;
      notifyJob(key);
    }

    job.loading = false;
    job.error = "";
    job.estimatedSecondsRemaining = 0;
    setCachedArticleTranslation(key, mergedTranslations);
    setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, mergedTranslations);
    notifyJob(key);
  } catch (translationRequestError) {
    if (controller.signal.aborted) {
      return;
    }
    job.loading = false;
    job.error =
      translationRequestError instanceof Error ? translationRequestError.message : "全文翻译生成失败，请稍后重试。";
    notifyJob(key);
  }
}
