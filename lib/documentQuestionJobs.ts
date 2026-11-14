"use client";

import type { SentenceQuestionRequest } from "@/types/reader";
import { saveDocumentQuestion, type DocumentQuestionTurn } from "./documentQuestionHistory";
import { getLearningStorage, LEARNING_STORAGE_EVENT } from "./learningStorage";
import { ACCOUNT_DATA_MERGED_EVENT } from "./accountEvents";
import { ACCOUNT_STORAGE_TRANSITION_EVENT, isAccountStorageTransition } from "./accountStorageTransition";

export interface DocumentQuestionJobSnapshot {
  turn: DocumentQuestionTurn;
  loading: boolean;
  error: string;
}
interface Job {
  snapshot: DocumentQuestionJobSnapshot;
  controller: AbortController;
  owner: string | null | undefined;
}
const jobs = new Map<string, Job>();
const listeners = new Map<string, Set<() => void>>();
const observedWindows = new WeakSet<Window>();

function currentOwner() {
  try {
    const storage = getLearningStorage();
    return isAccountStorageTransition(storage) ? undefined : storage.getItem("context-reader:local-account-owner:v1");
  } catch { return null; }
}
function notify(scope: string) { listeners.get(scope)?.forEach(listener => listener()); }
function observeOwner() {
  if (typeof window === "undefined" || observedWindows.has(window)) return;
  observedWindows.add(window);
  const discard = () => {
    const owner = currentOwner();
    for (const [scope, job] of jobs) {
      if (job.owner === owner) continue;
      job.controller.abort(); jobs.delete(scope); notify(scope);
    }
  };
  window.addEventListener(LEARNING_STORAGE_EVENT, discard);
  window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, discard);
  window.addEventListener(ACCOUNT_STORAGE_TRANSITION_EVENT, discard);
}
export function getDocumentQuestionJob(scope: string): DocumentQuestionJobSnapshot | null {
  return jobs.get(scope)?.snapshot ?? null;
}
export function subscribeDocumentQuestionJob(scope: string, listener: () => void) {
  observeOwner();
  const group = listeners.get(scope) ?? new Set();
  group.add(listener); listeners.set(scope, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(scope); };
}

/** Panel lifetime is deliberately independent of transport and durable saving.
 * Account replacement cancels; collapsing, selection and Reader unmount do not.
 */
export function startDocumentQuestionJob(scope: string, request: SentenceQuestionRequest): void {
  observeOwner();
  if (jobs.get(scope)?.snapshot.loading) return;
  const turn: DocumentQuestionTurn = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), question: request.question, answer: "" };
  const job: Job = { snapshot: { turn, loading: true, error: "" }, controller: new AbortController(), owner: currentOwner() };
  jobs.set(scope, job); notify(scope);
  const isCurrent = () => jobs.get(scope) === job && !job.controller.signal.aborted && job.owner === currentOwner();
  void (async () => {
    try {
      const response = await fetch("/api/ask-sentence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: job.controller.signal, body: JSON.stringify(request),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok || typeof data.answer !== "string" || !data.answer.trim()) {
        throw new Error(response.status === 401 ? "请登录后继续提问。" : "暂时未能取得回答，问题已保留，可以重试。");
      }
      const completed = { ...turn, answer: data.answer, sources: data.sources, notice: data.searchNotice };
      // Keep the completed answer in memory even if local persistence fails.
      job.snapshot = { turn: completed, loading: false, error: "" }; notify(scope);
      try { await saveDocumentQuestion(scope, completed); }
      catch {
        if (isCurrent()) {
          job.snapshot = { ...job.snapshot, error: "回答已生成，但本机历史保存失败。请复制保留此回答。" }; notify(scope);
        }
      }
    } catch (error) {
      if (isCurrent()) {
        job.snapshot = { turn, loading: false, error: error instanceof Error && error.message.startsWith("请登录") ? error.message : "暂时未能取得回答，问题已保留，可以重试。" };
        notify(scope);
      }
    }
  })();
}
