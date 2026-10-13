"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drainStudyReviews, migrateStudyReview, readStudyReviews, storeStudyReview, studyReviewStorageEvent, type PendingStudyReview } from "@/lib/studyReviewQueue";
import type { StudySnapshot } from "@/types/study";

export function useStudyReviewQueue(owner: string, api: <T>(body?: unknown) => Promise<T>, accept: (snapshot: StudySnapshot) => void) {
  const [pending, setPending] = useState<PendingStudyReview[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const pendingRef = useRef<PendingStudyReview[]>([]);
  const active = useRef(false), running = useRef(false), retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0), acceptRef = useRef(accept);
  acceptRef.current = accept;
  const changed = useCallback((items: PendingStudyReview[]) => { pendingRef.current = items; setPending(items); }, []);
  const drainRef = useRef<() => Promise<void>>(async () => {});
  const drain = useCallback(async () => {
    if (!active.current || running.current) return;
    if (retry.current) clearTimeout(retry.current);
    retry.current = null; running.current = true;
    try {
      migrateStudyReview(window.localStorage, window.sessionStorage, owner);
      changed(readStudyReviews(window.localStorage, owner));
      setReady(true);
      await drainStudyReviews(window.localStorage, owner, api, {
        active: () => active.current,
        changed,
        saved: snapshot => { failures.current = 0; setError(""); acceptRef.current(snapshot); },
        conflict: () => setError("这个词已在其他页面更新，已保留最新进度。请核对后继续。"),
      });
      failures.current = 0;
    } catch (error) {
      if (active.current) {
        setError(error instanceof TypeError ? "网络暂时未连接，答案已保存在本机，将自动重试。" : "答案已保存在本机，暂时无法同步。恢复后将自动重试。");
        const status = (error as {status?: number}).status;
        if (status !== 401 && status !== 403 && (status !== 409 || (error as {code?: string}).code === "too_fast")) {
          const delay = [1500, 4000, 10000, 30000][Math.min(failures.current++, 3)];
          retry.current = setTimeout(() => { void drainRef.current(); }, delay);
        }
      }
    } finally { running.current = false; }
  }, [api, changed, owner]);
  drainRef.current = drain;
  useEffect(() => {
    active.current = true;
    try {
      migrateStudyReview(window.localStorage, window.sessionStorage, owner);
      changed(readStudyReviews(window.localStorage, owner));
      setReady(true);
      void drain();
    } catch { setError("无法读取本机学习记录，请保留页面后重试。"); }
    const storage = (event: StorageEvent) => {
      if (!studyReviewStorageEvent(event.key, owner)) return;
      try { changed(readStudyReviews(window.localStorage, owner)); void drain(); }
      catch { setError("无法读取本机学习记录，请保留页面后重试。"); }
    };
    const online = () => { void drain(); };
    window.addEventListener("storage", storage); window.addEventListener("online", online);
    return () => {
      active.current = false;
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener("storage", storage); window.removeEventListener("online", online);
    };
  }, [changed, drain, owner]);
  const enqueue = useCallback((review: PendingStudyReview) => {
    if (!ready) throw new Error("学习记录尚未准备好，请稍后再试。");
    if (pendingRef.current.some(item => item.cardId === review.cardId)) return false;
    try {
      storeStudyReview(window.localStorage, owner, review);
      changed(readStudyReviews(window.localStorage, owner));
    } catch { throw new Error("本机空间不足或保存受限，请保留当前答案后重试。"); }
    void drain();
    return true;
  }, [changed, drain, owner, ready]);
  return { pending, pendingRef, enqueue, retry: drain, error, ready };
}
