"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { getLearningStorage, LEARNING_STORAGE_EVENT } from "@/lib/learningStorage";
import { getCachedArticleTranslation, getCachedArticleTranslationForBlocks } from "@/lib/cache";
import { getArticleTranslationJobSnapshot, subscribeArticleTranslationJob, type ArticleTranslationJobSnapshot } from "@/lib/articleTranslationJobs";
import type { ArticleTranslationBlock, ArticleTranslationItem } from "@/types/reader";

interface ReaderTranslationSession extends ArticleTranslationJobSnapshot {
  owner: string | null | undefined;
  staleBlockIds: string[];
  removedCount: number;
}

function emptySession(): ReaderTranslationSession {
  return { owner: undefined, translations: [], loading: false, error: "", requested: false,
    estimatedSecondsRemaining: null, retryAfterSeconds: null, retryReason: null, regenerating: false,
    completedTargetBlocks: 0, totalTargetBlocks: 0, staleBlockIds: [], removedCount: 0 };
}

export function preparedTranslationOwner(): string | null {
  try { return getLearningStorage().getItem("context-reader:local-account-owner:v1"); }
  catch { return null; }
}

/** An account can change while Reader stays mounted. Bind to the prepared storage
 * owner, but expose data only when it also matches the Reader's account identity. */
export function useReaderTranslationSession(key: string, blocks: ArticleTranslationBlock[], expectedOwner: string | null) {
  const [state, setState] = useState<ReaderTranslationSession>(emptySession);
  const lastDisplay = useRef(state);

  useEffect(() => {
    let disposed = false;
    let boundOwner = preparedTranslationOwner();
    let unsubscribe: (() => void) | undefined;
    function publish(next: ReaderTranslationSession) {
      if (disposed) return;
      lastDisplay.current = next;
      setState(next);
    }
    function bind(preserveCurrent: boolean) {
      unsubscribe?.(); unsubscribe = undefined;
      const owner = preparedTranslationOwner();
      boundOwner = owner;
      if (owner !== expectedOwner) { publish(emptySession()); return; }
      const previous = preserveCurrent && lastDisplay.current.owner === owner ? lastDisplay.current : emptySession();
      const applySnapshot = (snapshot: ArticleTranslationJobSnapshot) => {
        if (preparedTranslationOwner() !== owner) return;
        const successful = !snapshot.loading && !snapshot.error;
        publish({ ...snapshot, owner,
          staleBlockIds: successful ? [] : lastDisplay.current.staleBlockIds,
          removedCount: successful ? 0 : lastDisplay.current.removedCount });
      };
      const running = getArticleTranslationJobSnapshot(key);
      if (running) {
        publish({ ...running, owner, staleBlockIds: [], removedCount: 0 });
      } else {
        const byId = new Map(getCachedArticleTranslationForBlocks(blocks).map(item => [item.id, item]));
        for (const item of getCachedArticleTranslation(key) ?? []) byId.set(item.id, item);
        const exact = blocks.map(block => byId.get(block.id)).filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
        const exactIds = new Set(exact.map(item => item.id));
        const previousById = new Map(previous.translations.map(item => [item.id, item.translation]));
        const blockIds = new Set(blocks.map(block => block.id));
        const stale = blocks.filter(block => !exactIds.has(block.id) && previousById.has(block.id))
          .map(block => ({ id: block.id, translation: previousById.get(block.id) ?? "" })).filter(item => item.translation.trim());
        const merged = [...exact, ...stale];
        const cached = merged.length > 0 ? merged : getCachedArticleTranslation(key);
        publish({ ...emptySession(), owner, translations: cached ?? [], requested: Boolean(cached),
          staleBlockIds: stale.map(item => item.id), removedCount: previous.translations.filter(item => !blockIds.has(item.id)).length });
      }
      unsubscribe = subscribeArticleTranslationJob(key, applySnapshot);
    }
    function ownerChanged() {
      if (preparedTranslationOwner() === boundOwner) return;
      // Clear on every transition, including A -> B -> A inside one React batch.
      publish(emptySession());
      bind(false);
    }
    window.addEventListener(LEARNING_STORAGE_EVENT, ownerChanged);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, ownerChanged);
    bind(true);
    return () => {
      disposed = true; unsubscribe?.();
      window.removeEventListener(LEARNING_STORAGE_EVENT, ownerChanged);
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, ownerChanged);
    };
  }, [key, blocks, expectedOwner]);

  const ready = preparedTranslationOwner() === expectedOwner;
  const visible = ready && state.owner === expectedOwner ? state : emptySession();
  function showCachedTranslations(translations: ArticleTranslationItem[]) {
    if (preparedTranslationOwner() !== expectedOwner) return;
    const next = { ...visible, owner: expectedOwner, translations, error: "", requested: true };
    lastDisplay.current = next; setState(next);
  }
  return { ...visible, ready, showCachedTranslations };
}
