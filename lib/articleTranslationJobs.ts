"use client";

import {
  setCachedArticleTranslation,
  setCachedArticleTranslationForBlocks,
} from "@/lib/cache";
import { fetchJson } from "@/lib/apiClient";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";
import { createArticleTranslationBatches } from "@/lib/articleTranslationBatching";
import { requestArticleTranslation, withTranslationTimeout, FALLBACK_ERROR, type TranslationApiResponse } from "@/lib/articleTranslationTransport";
import { createArticleTranslationProgress } from "@/lib/articleTranslationProgress";
import { getLearningStorage, LEARNING_STORAGE_EVENT } from "@/lib/learningStorage";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { ACCOUNT_STORAGE_TRANSITION_EVENT, isAccountStorageTransition } from "@/lib/accountStorageTransition";

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
  owner: string | null;
  usageStarted: boolean;
  requestedSettlement?: "succeeded" | "failed" | "cancelled";
  settled?: boolean;
  controller: AbortController;
  actionId: string;
  startedAt: number;
  totalBlocks: number;
}

const jobs = new Map<string, ArticleTranslationJob>();
const listeners = new Map<string, Set<ArticleTranslationJobListener>>();
const observedWindows = new WeakSet<Window>();

function currentOwner(): string | null | undefined {
  try {
    const storage = getLearningStorage();
    return isAccountStorageTransition(storage) ? undefined : storage.getItem("context-reader:local-account-owner:v1");
  } catch { return null; }
}

function listenerKey(key: string, owner: string | null | undefined): string {
  return JSON.stringify([owner === undefined ? "unprepared" : "owner", owner ?? null, key]);
}

function discardOtherOwners(): void {
  const owner = currentOwner();
  for (const [key, job] of jobs) {
    if (job.owner === owner) continue;
    jobs.delete(key);
    if (job.loading && !job.controller.signal.aborted) {
      job.controller.abort();
      void finishJobUsage(job, "cancelled");
    }
  }
}

function observeOwnerChanges(): void {
  if (typeof window === "undefined" || observedWindows.has(window)) return;
  observedWindows.add(window);
  // React unmounts are deliberately not cancellation; an account owner replacement is.
  window.addEventListener(LEARNING_STORAGE_EVENT, discardOtherOwners);
  window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, discardOtherOwners);
  window.addEventListener(ACCOUNT_STORAGE_TRANSITION_EVENT, discardOtherOwners);
}

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
  if (!job || job.owner !== currentOwner()) return;
  const snapshot = snapshotJob(job);
  listeners.get(listenerKey(key, job.owner))?.forEach((listener) => listener(snapshot));
}

async function startTranslationUsage(
  actionId: string,
  cacheKey: string,
  blocks: ArticleTranslationBlock[],
  source: "generated" | "public_cache",
  publicArticleId?: string,
): Promise<TranslationStartResponse> {
  const { response, data } = await withTranslationTimeout(signal => fetchJson<TranslationStartResponse>("/api/translate-article/start", {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actionId,
      cacheKey,
      source,
      publicArticleId,
      blocks,
      articleCharacters: blocks.reduce((sum, block) => sum + block.text.length, 0),
      blockCount: blocks.length,
    }),
  }, "全文翻译次数校验失败，请稍后重试。", { operation: "article_translation_start" }), 30_000);
  if (!response.ok || !data?.actionId) throw new Error(data?.error || "全文翻译次数校验失败，请稍后重试。");
  return data;
}

async function finishTranslationUsage(actionId: string, status: "succeeded" | "failed" | "cancelled"): Promise<void> {
  await withTranslationTimeout(signal => fetch("/api/translate-article/finish", {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, status }),
    keepalive: true,
  }), 10_000).catch(() => undefined);
}

function finishJobUsage(job: ArticleTranslationJob, status: "succeeded" | "failed" | "cancelled"): Promise<void> {
  job.requestedSettlement ??= status;
  // Cancellation may win while /start is still reserving usage. Settle only after
  // its response confirms the real action id (public-cache actions can replace it).
  if (!job.usageStarted) return Promise.resolve();
  if (job.settled) return Promise.resolve();
  job.settled = true;
  return finishTranslationUsage(job.actionId, job.requestedSettlement);
}

export function getArticleTranslationJobSnapshot(key: string): ArticleTranslationJobSnapshot | null {
  const job = jobs.get(key);
  return job && job.owner === currentOwner() ? snapshotJob(job) : null;
}

export function subscribeArticleTranslationJob(key: string, listener: ArticleTranslationJobListener): () => void {
  const scopedKey = listenerKey(key, currentOwner());
  const keyListeners = listeners.get(scopedKey) ?? new Set<ArticleTranslationJobListener>();
  keyListeners.add(listener);
  listeners.set(scopedKey, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(scopedKey);
  };
}

export async function startArticleTranslationJob(
  key: string,
  blocks: ArticleTranslationBlock[],
  options: {
    force?: boolean;
    initialTranslations?: ArticleTranslationItem[];
    allBlocks?: ArticleTranslationBlock[];
    contextBlocks?: ArticleTranslationBlock[];
    publicCache?: { articleId: string };
    publicArticleId?: string;
  } = {},
): Promise<void> {
  observeOwnerChanges();
  discardOtherOwners();
  const owner = currentOwner();
  if (owner === undefined) return;
  const existingJob = jobs.get(key);
  if (existingJob?.owner === owner && existingJob.loading && !options.force) return;
  if (existingJob?.owner === owner && !existingJob.loading && !existingJob.error && existingJob.translations.length > 0 && !options.force) return;
  if (existingJob?.loading) {
    existingJob.controller.abort();
    void finishJobUsage(existingJob, "cancelled");
  }

  const controller = new AbortController();
  let actionId = crypto.randomUUID();
  const initialTranslations = options.initialTranslations ?? [];
  const job: ArticleTranslationJob = {
    owner,
    usageStarted: false,
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
  const ensureCurrentJob = () => {
    if (!controller.signal.aborted && job.owner !== currentOwner()) {
      controller.abort();
      if (jobs.get(key) === job) jobs.delete(key);
      void finishJobUsage(job, "cancelled");
    }
    if (controller.signal.aborted || jobs.get(key) !== job) throw new DOMException("Aborted", "AbortError");
  };

  try {
    const allBlocks = options.allBlocks ?? blocks;
    const start = await startTranslationUsage(
      actionId,
      key,
      options.publicCache ? allBlocks : blocks,
      options.publicCache ? "public_cache" : "generated",
      options.publicCache?.articleId ?? options.publicArticleId,
    );
    actionId = start.actionId ?? actionId;
    job.actionId = actionId;
    job.usageStarted = true;
    if (job.requestedSettlement) await finishJobUsage(job, job.requestedSettlement);
    ensureCurrentJob();

    if (options.publicCache) {
      const available = new Map((start.translations ?? []).map((item) => [item.id, item]));
      const ordered = allBlocks.map((block) => available.get(block.id)).filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
      if (ordered.length !== allBlocks.length) throw new Error("精选文章的预发布译文不完整，请联系管理员更新。");
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const revealed: ArticleTranslationItem[] = [];
      for (const translation of ordered) {
        ensureCurrentJob();
        revealed.push(translation);
        job.translations = [...revealed];
        job.completedTargetBlocks = revealed.length;
        job.estimatedSecondsRemaining = 0;
        notifyJob(key);
        if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 45));
      }
      ensureCurrentJob();
      job.loading = false;
      job.error = "";
      setCachedArticleTranslation(key, ordered);
      setCachedArticleTranslationForBlocks(allBlocks, ordered);
      notifyJob(key);
      return;
    }

    const progress = createArticleTranslationProgress(allBlocks, initialTranslations);
    for (const batch of (blocks.some(block => block.id.startsWith("doc-")) ? blocks.map(block => [block]) : createArticleTranslationBatches(blocks))) {
      await requestArticleTranslation(batch, controller.signal, options.contextBlocks ?? allBlocks, actionId, (delaySeconds, reason) => {
        // This callback also runs from an interval; abort the transport without
        // throwing out of the browser's timer callback.
        try { ensureCurrentJob(); } catch { return; }
        job.retryAfterSeconds = delaySeconds;
        job.retryReason = reason;
        notifyJob(key);
      }, (translation) => {
        ensureCurrentJob();
        job.retryAfterSeconds = null;
        job.retryReason = null;
        const next = progress.accept(translation);
        job.translations = next.translations;
        job.completedTargetBlocks = next.completedTargetBlocks;
        setCachedArticleTranslation(key, job.translations);
        // The stream changes one block. Do not rebuild the whole article's block index per event.
        const translatedBlock = progress.block(translation.id);
        setCachedArticleTranslationForBlocks(translatedBlock ? [translatedBlock] : [], [translation]);
        const completedBlocks = Math.max(1, job.completedTargetBlocks);
        const remainingBlocks = Math.max(0, job.totalBlocks - job.completedTargetBlocks);
        const elapsedSeconds = Math.max(1, (Date.now() - job.startedAt) / 1_000);
        job.estimatedSecondsRemaining = remainingBlocks > 0 ? Math.ceil((elapsedSeconds / completedBlocks) * remainingBlocks) : 0;
        notifyJob(key);
      });
    }
    ensureCurrentJob();
    job.loading = false;
    job.error = "";
    job.estimatedSecondsRemaining = 0;
    job.retryAfterSeconds = null;
    job.retryReason = null;
    setCachedArticleTranslation(key, job.translations);
    setCachedArticleTranslationForBlocks(allBlocks, job.translations);
    notifyJob(key);
    await finishJobUsage(job, "succeeded");
  } catch (translationRequestError) {
    // The failed response may also arrive after logout/account replacement.
    try { ensureCurrentJob(); } catch { return; }
    if (controller.signal.aborted) return;
    job.loading = false;
    job.retryAfterSeconds = null;
    job.retryReason = null;
    job.error = translationRequestError instanceof Error ? translationRequestError.message : FALLBACK_ERROR;
    if (job.translations.length > 0) {
      setCachedArticleTranslation(key, job.translations);
      setCachedArticleTranslationForBlocks(options.allBlocks ?? blocks, job.translations);
    }
    notifyJob(key);
    await finishJobUsage(job, "failed");
  }
}
