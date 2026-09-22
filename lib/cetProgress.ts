"use client";
import type { CetAttempt } from "@/types/cet";
import { getLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
export const CET_PROGRESS_KEY = "context-reader:cet-progress:v1";
export const CET_OBJECT_PREFIX = "cet-attempt:";
export function normalizeCetAttempt(value: unknown): CetAttempt | null {
  const x = value as CetAttempt;
  if (
    !x ||
    typeof x.id !== "string" ||
    !x.id ||
    typeof x.scope !== "string" ||
    typeof x.paperId !== "string" ||
    typeof x.activeSection !== "string" ||
    !["exam", "study"].includes(x.mode) ||
    !Number.isFinite(Date.parse(x.updatedAt)) ||
    !x.answers ||
    !x.answerTimes ||
    !x.revealed ||
    !x.timerParts ||
    typeof x.timerEpoch !== "string"
  )
    return null;
  if (
    !Number.isFinite(Date.parse(x.timerEpoch)) ||
    !Number.isFinite(Date.parse(x.createdAt)) ||
    typeof x.title !== "string" ||
    (x.finishedAt && !Number.isFinite(Date.parse(x.finishedAt)))
  )
    return null;
  if (
    [x.answers, x.answerTimes, x.revealed, x.timerParts].some(
      (v) => typeof v !== "object" || Array.isArray(v),
    )
  )
    return null;
  if (
    Object.values(x.answers).some(
      (v) => typeof v !== "string" || !/^[A-Z]?$/.test(v),
    ) ||
    Object.values(x.timerParts).some(
      (v) => !Number.isSafeInteger(v) || v < 0,
    ) ||
    [...Object.values(x.answerTimes), ...Object.values(x.revealed)].some(
      (v) => typeof v !== "string" || !Number.isFinite(Date.parse(v)),
    )
  )
    return null;
  return {
    ...x,
    elapsedMs: Object.values(x.timerParts).reduce((a, b) => a + b, 0),
  };
}
export function readCetAttempts(
  storage: Storage = getLearningStorage(),
): CetAttempt[] {
  try {
    const a = JSON.parse(storage.getItem(CET_PROGRESS_KEY) || "[]");
    return Array.isArray(a)
      ? a.map(normalizeCetAttempt).filter((v): v is CetAttempt => !!v)
      : [];
  } catch {
    return [];
  }
}
// Answers merge by question timestamp; timer contributions merge by device segment.
// A deliberate reset establishes a new epoch, so older devices cannot restore old time.
export function mergeCetAttempt(
  a: CetAttempt | undefined,
  b: CetAttempt,
): CetAttempt {
  if (!a) return b;
  const next = {
    ...(a.updatedAt > b.updatedAt ? a : b),
    answers: { ...a.answers },
    answerTimes: { ...a.answerTimes },
    revealed: { ...a.revealed, ...b.revealed },
  };
  for (const [key, time] of Object.entries(b.answerTimes))
    if (!next.answerTimes[key] || time > next.answerTimes[key]) {
      next.answers[key] = b.answers[key];
      next.answerTimes[key] = time;
    }
  const epoch = a.timerEpoch > b.timerEpoch ? a.timerEpoch : b.timerEpoch;
  next.timerEpoch = epoch;
  next.timerParts = {};
  for (const source of [a, b])
    if (source.timerEpoch === epoch)
      for (const [key, n] of Object.entries(source.timerParts))
        next.timerParts[key] = Math.max(next.timerParts[key] || 0, n);
  next.elapsedMs = Object.values(next.timerParts).reduce(
    (sum, n) => sum + n,
    0,
  );
  next.finishedAt = a.finishedAt || b.finishedAt;
  return next;
}
export function writeCetAttempts(storage: Storage, items: CetAttempt[]) {
  storage.setItem(CET_PROGRESS_KEY, JSON.stringify(items));
}
export function saveCetAttempt(item: CetAttempt) {
  const storage = getLearningStorage(),
    all = readCetAttempts(storage),
    old = all.find((x) => x.id === item.id),
    next = mergeCetAttempt(old, item);
  writeCetAttempts(storage, [...all.filter((x) => x.id !== item.id), next]);
  notifyAccountDataChanged(["preferences"]);
  return next;
}
