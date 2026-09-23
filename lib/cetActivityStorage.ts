"use client";

import type { CetActivity, CetFinalization } from "@/types/cet";
import { mergeCetActivity } from "@/lib/cetActivity";
import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";

export const CET_ACTIVITIES_KEY = "context-reader:cet-activities:v2";
export const CET_FINALIZATIONS_KEY = "context-reader:cet-finalizations:v2";
export const CET_ACTIVITY_OBJECT_PREFIX = "cet-activity:v2:";
export const CET_FINALIZATION_OBJECT_PREFIX = "cet-finalization:v2:";

export function normalizeCetActivity(value: unknown): CetActivity | null {
  if (!value || typeof value !== "object") return null;
  const a = value as CetActivity;
  if (a.schemaVersion !== 2 || !a.id || !a.owner || !["practice", "self_test"].includes(a.purpose)
    || !a.paperId || !a.scopeKey || !a.contentVersion || !a.title || !a.activeSection
    || !["in_progress", "paused", "submitted", "ended"].includes(a.status)
    || !Array.isArray(a.sectionIds) || !Array.isArray(a.questionKeys)
    || !a.answers || typeof a.answers !== "object" || Array.isArray(a.answers)
    || !a.finalizations || typeof a.finalizations !== "object" || Array.isArray(a.finalizations)
    || !a.timerParts || typeof a.timerParts !== "object" || Array.isArray(a.timerParts)
    || !Array.isArray(a.knownPriorSectionIds) || !Array.isArray(a.conditions)
    || !Number.isFinite(Date.parse(a.createdAt)) || !Number.isFinite(Date.parse(a.startedAt))
    || !Number.isFinite(Date.parse(a.updatedAt)) || !a.timerRevision) return null;
  if (a.purpose === "self_test" && !a.legacy && (!Number.isFinite(a.budgetMs) || !Number.isFinite(a.remainingMs))) return null;
  if (Object.values(a.answers).some((r) => !r || typeof r.value !== "string" || !r.eventId || !Number.isFinite(Date.parse(r.at)))) return null;
  if (Object.entries(a.finalizations).some(([id, f]) => !f || f.id !== id || !Number.isFinite(Date.parse(f.at)) || !Array.isArray(f.questions))) return null;
  return a;
}

export interface CetCommitPackage { id?: string; attemptId: string; finalization: CetFinalization }

export function readCetCommitPackages(storage: Storage = getLearningStorage()): CetCommitPackage[] {
  try {
    const raw = JSON.parse(storage.getItem(CET_FINALIZATIONS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((p): p is CetCommitPackage => Boolean(p?.attemptId && p.finalization?.id && Array.isArray(p.finalization.questions))) : [];
  } catch {
    return [];
  }
}

export function writeCetCommitPackages(storage: Storage, items: CetCommitPackage[]): void {
  storage.setItem(CET_FINALIZATIONS_KEY, JSON.stringify(items));
}

export function readCetActivities(storage: Storage = getLearningStorage()): CetActivity[] {
  try {
    const raw = JSON.parse(storage.getItem(CET_ACTIVITIES_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const commits = readCetCommitPackages(storage);
    const byAttempt = new Map<string, CetCommitPackage[]>();
    for (const item of commits) byAttempt.set(item.attemptId, [...(byAttempt.get(item.attemptId) || []), item]);
    return raw.map(normalizeCetActivity).filter((a): a is CetActivity => Boolean(a)).map((activity) => {
      const own = byAttempt.get(activity.id) || [];
      if (!own.length) return activity;
      let repaired = activity;
      for (const p of own) {
        if (repaired.finalizations[p.finalization.id]) continue;
        repaired = mergeCetActivity(repaired, {
          ...repaired,
          finalizations: { ...repaired.finalizations, [p.finalization.id]: p.finalization },
          status: p.finalization.reason === "ended_for_study" ? "ended" : "submitted",
          submittedAt: p.finalization.reason === "ended_for_study" ? undefined : p.finalization.at,
          endedAt: p.finalization.reason === "ended_for_study" ? p.finalization.at : undefined,
        });
      }
      return repaired;
    });
  } catch {
    return [];
  }
}

export function writeCetActivities(storage: Storage, items: CetActivity[]): void {
  storage.setItem(CET_ACTIVITIES_KEY, JSON.stringify(items));
}

export function saveCetActivity(item: CetActivity, storage: Storage = getLearningStorage()): CetActivity {
  if (isLearningStorage(storage)) {
    const old = normalizeCetActivity(storage.getRecord(CET_ACTIVITIES_KEY, item.id));
    if (!old && !storage.getItem(CET_ACTIVITIES_KEY)) storage.setItem(CET_ACTIVITIES_KEY, "[]");
    const next = mergeCetActivity(old || undefined, item);
    for (const finalization of Object.values(next.finalizations)) {
      const id = `${next.id}:${finalization.id}`;
      if (!storage.getRecord(CET_FINALIZATIONS_KEY, id)) {
        if (!storage.getItem(CET_FINALIZATIONS_KEY)) storage.setItem(CET_FINALIZATIONS_KEY, "[]");
        storage.setRecord(CET_FINALIZATIONS_KEY, id, { id, attemptId: next.id, finalization });
      }
    }
    storage.setRecord(CET_ACTIVITIES_KEY, item.id, next);
    notifyAccountDataChanged(["preferences"]);
    return next;
  }
  const all = readCetActivities(storage);
  const old = all.find((a) => a.id === item.id);
  const next = mergeCetActivity(old, item);
  const packages = readCetCommitPackages(storage);
  const known = new Set(packages.map((p) => `${p.attemptId}:${p.finalization.id}`));
  const additions = Object.values(next.finalizations)
    .filter((f) => !known.has(`${next.id}:${f.id}`))
    .map((finalization) => ({ id: `${next.id}:${finalization.id}`, attemptId: next.id, finalization }));
  if (additions.length) writeCetCommitPackages(storage, [...packages, ...additions]);
  writeCetActivities(storage, [...all.filter((a) => a.id !== item.id), next]);
  notifyAccountDataChanged(["preferences"]);
  return next;
}

// Each finalization is also its own protocol-2 object. A stale mutable activity
// object cannot delete the committed snapshot from the cloud manifest.
export function collectCetFinalizations(items: CetActivity[]): { attemptId: string; finalization: CetFinalization }[] {
  return items.flatMap((activity) => Object.values(activity.finalizations).map((finalization) => ({ attemptId: activity.id, finalization })));
}
