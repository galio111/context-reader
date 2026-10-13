import type { StudyAnswer, StudySnapshot } from "@/types/study";

export interface PendingStudyReview {
  op: "review"; id: string; cardId: string; version: number; token: string;
  answer: StudyAnswer; activeMs: number; queuedAt: number;
}
type QueueStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const prefix = (owner: string) => "context-reader-study-outbox:v1:" + owner + ":";
const uuid = /^[0-9a-f-]{36}$/i;
const valid = (p: PendingStudyReview) => p?.op === "review" && uuid.test(p.id) && uuid.test(p.token)
  && /^[a-f0-9]{40}$/.test(p.cardId) && Number.isSafeInteger(p.version) && p.version >= 0
  && ["forgot", "unsure_wrong", "unsure_right", "remembered"].includes(p.answer)
  && Number.isFinite(p.activeMs) && p.activeMs >= 0 && p.activeMs <= 60000 && Number.isFinite(p.queuedAt);

export function readStudyReviews(storage: QueueStorage, owner: string): PendingStudyReview[] {
  if (!owner) return [];
  const start = prefix(owner), reviews: PendingStudyReview[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(start)) continue;
    const item = JSON.parse(storage.getItem(key) || "null") as PendingStudyReview;
    if (!valid(item) || key !== start + item.id) throw new Error("本机待保存的学习记录无法读取，请保留页面后重试。");
    reviews.push(item);
  }
  return reviews.sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

/** One key per immutable answer avoids one tab overwriting another tab's outbox. */
export function storeStudyReview(storage: QueueStorage, owner: string, review: PendingStudyReview): void {
  if (!owner || !valid(review)) throw new Error("本次学习记录无效，请重新打开背词。");
  const key = prefix(owner) + review.id, value = JSON.stringify(review);
  const existing = storage.getItem(key);
  if (existing && existing !== value) throw new Error("本次学习记录已存在，请重试。");
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("无法可靠保存学习记录，请保留页面后重试。");
}

export function migrateStudyReview(storage: QueueStorage, session: Pick<Storage,"getItem"|"removeItem">, owner: string): void {
  const key = "context-reader-study-pending:" + owner, old = session.getItem(key);
  if (!old) return;
  const review = JSON.parse(old) as PendingStudyReview;
  // A legacy pending answer keeps its id, token and answer when migrated.
  const queuedAt = review.queuedAt ?? 0;
  const existing = readStudyReviews(storage, owner).find(item => item.id === review.id);
  if (!existing) storeStudyReview(storage, owner, { ...review, queuedAt });
  session.removeItem(key);
}

export interface ReviewQueueCallbacks {
  active: () => boolean;
  changed: (pending: PendingStudyReview[], acknowledgedId: string) => void;
  saved: (snapshot: StudySnapshot) => void;
  conflict: () => void;
}

/** The server owns memory, scheduling and rewards. Only the pending display is optimistic. */
export async function drainStudyReviews(
  storage: QueueStorage, owner: string,
  api: <T>(body?: unknown) => Promise<T>, callbacks: ReviewQueueCallbacks,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  while (callbacks.active()) {
    const review = readStudyReviews(storage, owner)[0];
    if (!review) return;
    let snapshot: StudySnapshot;
    let conflict = false;
    try {
      let response: { snapshot: StudySnapshot };
      try { response = await api<{ snapshot: StudySnapshot }>(review); }
      catch (error) {
        const code = (error as {code?: string}).code;
        if (code === "day_changed") {
          // A prior day's presented card keeps its token and version. Creating
          // today's plan does not present it again or replace the original answer.
          await api<StudySnapshot>({ op: "start" });
        } else if (code === "too_fast") await sleep(850);
        else throw error;
        if (!callbacks.active()) return;
        response = await api<{ snapshot: StudySnapshot }>(review);
      }
      snapshot = response.snapshot;
    } catch (error) {
      if ((error as {code?: string}).code !== "state_changed") throw error;
      // Confirm the authoritative state before resolving an answer invalidated elsewhere.
      snapshot = await api<StudySnapshot>();
      conflict = true;
    }
    if (!callbacks.active()) return;
    storage.removeItem(prefix(owner) + review.id);
    callbacks.changed(readStudyReviews(storage, owner), review.id);
    callbacks.saved(snapshot);
    if (conflict) callbacks.conflict();
  }
}

export function studyReviewStorageEvent(key: string | null, owner: string) { return key === null || key.startsWith(prefix(owner)); }
