"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drainStudyReviews, migrateStudyReview, readStudyReviews, storeStudyReview, studyReviewStorageEvent, type PendingStudyReview } from "@/lib/studyReviewQueue";
import type { StudySnapshot, StudyReviewReceipt } from "@/types/study";

export function useStudyReviewQueue(owner: string, api: <T>(body?: unknown) => Promise<T>, accept: (snapshot: StudySnapshot) => void, confirm: (receipt: StudyReviewReceipt) => void) {
  const [pending, setPending] = useState<PendingStudyReview[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const pendingRef = useRef<PendingStudyReview[]>([]);
  const active = useRef(false), running = useRef(false), retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0), acceptRef = useRef(accept);
  acceptRef.current = accept;
  const confirmRef = useRef(confirm);confirmRef.current=confirm;
  const changed = useCallback((items: PendingStudyReview[]) => { pendingRef.current = items; setPending(items); }, []);
  const mergeStored = useCallback((items: PendingStudyReview[], acknowledged = new Set<string>()) => {
    const ids = new Set(items.map(item => item.id));
    // Another tab deleting a key is not a snapshot acknowledgement for this tab.
    // Keep its card hidden until a later server read confirms the updated state.
    changed([...items, ...pendingRef.current.filter(item => !ids.has(item.id) && !acknowledged.has(item.id))]);
  }, [changed]);
  const reconcileStored = useCallback(async () => {
    while (active.current) {
      const items = readStudyReviews(window.localStorage, owner), ids = new Set(items.map(item => item.id));
      const missing = new Set(pendingRef.current.filter(item => !ids.has(item.id)).map(item => item.id));
      if (!missing.size) { changed(items); return; }
      const snapshot = await api<StudySnapshot>();
      if (!active.current) return;
      acceptRef.current(snapshot);
      setError(""); failures.current = 0;
      // A second key may disappear while this request is in flight. That key
      // needs its own fresh snapshot, not the response started before its deletion.
      mergeStored(readStudyReviews(window.localStorage, owner), missing);
    }
  }, [api, changed, mergeStored, owner]);
  const drainRef = useRef<() => Promise<void>>(async () => {});
  const drain = useCallback(async () => {
    if (!active.current || running.current) return;
    if (retry.current) clearTimeout(retry.current);
    retry.current = null; running.current = true;
    try {
      migrateStudyReview(window.localStorage, window.sessionStorage, owner);
      await reconcileStored();
      if (!active.current) return;
      setReady(true);
      await drainStudyReviews(window.localStorage, owner, api, {
        active: () => active.current,
        changed: (items, acknowledgedId) => mergeStored(items, new Set([acknowledgedId])),
        saved: snapshot => { failures.current = 0; setError(""); acceptRef.current(snapshot); },
        confirmed: receipt => { confirmRef.current(receipt); failures.current=0;setError(""); },
        conflict: () => setError("这个词已在其他页面更新，已保留最新进度。请核对后继续。"),
      });
      await reconcileStored();
      failures.current = 0;
    } catch (error) {
      if (active.current) {
        const status = (error as {status?: number}).status;
        const retryable = status !== 401 && status !== 403 && (status !== 409 || ["too_fast", "day_changed"].includes((error as {code?: string}).code ?? ""));
        // Durable answers retry silently. Only an action the user must take gets a notice.
        setError(retryable ? "" : status === 401 ? "登录已过期，请重新登录后继续。" : status === 403 ? "账号暂时无法提交，请检查账号状态。" : "学习状态已变化，请重试后继续。");
        if (retryable) {
          const delay = [1500, 4000, 10000, 30000][Math.min(failures.current++, 3)];
          retry.current = setTimeout(() => { void drainRef.current(); }, delay);
        }
      }
    } finally { running.current = false; }
  }, [api, mergeStored, owner, reconcileStored]);
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
      try { mergeStored(readStudyReviews(window.localStorage, owner)); void drain(); }
      catch { setError("无法读取本机学习记录，请保留页面后重试。"); }
    };
    const online = () => { void drain(); };
    window.addEventListener("storage", storage); window.addEventListener("online", online);
    return () => {
      active.current = false;
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener("storage", storage); window.removeEventListener("online", online);
    };
  }, [changed, drain, mergeStored, owner]);
  const enqueue = useCallback((review: PendingStudyReview) => {
    if (!ready) throw new Error("学习记录尚未准备好，请稍后再试。");
    if (pendingRef.current.some(item => item.cardId === review.cardId)) return false;
    try {
      storeStudyReview(window.localStorage, owner, review);
      mergeStored(readStudyReviews(window.localStorage, owner));
    } catch { throw new Error("本机空间不足或保存受限，请保留当前答案后重试。"); }
    void drain();
    return true;
  }, [mergeStored, drain, owner, ready]);
  return { pending, pendingRef, enqueue, retry: drain, error, ready };
}
