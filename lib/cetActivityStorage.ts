"use client";

import type { CetActivity, CetFinalization } from "@/types/cet";
import { mergeCetActivity } from "@/lib/cetActivity";
import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";

export const CET_ACTIVITIES_KEY = "context-reader:cet-activities:v2";
export const CET_FINALIZATIONS_KEY = "context-reader:cet-finalizations:v2";
export const CET_ACTIVITY_OBJECT_PREFIX = "cet-activity:v2:";
export const CET_FINALIZATION_OBJECT_PREFIX = "cet-finalization:v2:";

export const CET_ACTIVITIES_V3_KEY = "context-reader:cet-activities:v3";
export const CET_FINALIZATIONS_V3_KEY = "context-reader:cet-finalizations:v3";
export const CET_ACTIVITIES_V4_KEY = "context-reader:cet-activities:v4";
export const CET_FINALIZATIONS_V4_KEY = "context-reader:cet-finalizations:v4";
export const cetActivityPrefix = (a: CetActivity) => `cet-activity:v${a.schemaVersion}:`;
export const cetCommitPrefix = (p: CetCommitPackage) => `cet-finalization:v${p.schemaVersion || 2}:`;
export const isCetActivityObject = (key: string) => /^cet-activity:v[234]:/.test(key);
export const isCetCommitObject = (key: string) => /^cet-finalization:v[234]:/.test(key);

export function normalizeCetActivity(value: unknown): CetActivity | null {
  if (!value || typeof value !== "object") return null;
  const a = value as CetActivity;
  if (![2, 3, 4].includes(a.schemaVersion) || !a.id || !a.owner || !["practice", "self_test"].includes(a.purpose)
    || !a.paperId || !a.scopeKey || !a.contentVersion || !a.title || !a.activeSection
    || !["in_progress", "paused", "submitted", "ended"].includes(a.status)
    || !Array.isArray(a.sectionIds) || !Array.isArray(a.questionKeys)
    || !a.answers || typeof a.answers !== "object" || Array.isArray(a.answers)
    || !a.finalizations || typeof a.finalizations !== "object" || Array.isArray(a.finalizations)
    || !a.timerParts || typeof a.timerParts !== "object" || Array.isArray(a.timerParts)
    || !Array.isArray(a.knownPriorSectionIds) || !Array.isArray(a.conditions)
    || !Number.isFinite(Date.parse(a.createdAt)) || !Number.isFinite(Date.parse(a.startedAt))
    || !Number.isFinite(Date.parse(a.updatedAt)) || !a.timerRevision) return null;
  if (a.schemaVersion === 4 && (!a.timerEpochs || ![2,3].includes(a.upgradedFromVersion!) || Object.entries(a.timerEpochs).some(([id,e])=>
    !e || e.eventId!==id || e.epochId!==id || typeof e.previousEpochId!=="string" || !["reset","countdown"].includes(e.kind)
    || !Number.isFinite(Date.parse(e.at)) || !["countup","countdown"].includes(e.mode) || !Number.isFinite(e.baseEffectiveMs)
    || e.baseEffectiveMs<0 || !["running","paused"].includes(e.runningState) || !["$self",...a.sectionIds].includes(e.scope)
    || e.mode==="countdown"&&(!Number.isFinite(e.budgetMs)||e.budgetMs!<60000||e.budgetMs!>10800000)))) return null;
  if (a.schemaVersion === 3 && (a.purpose !== "self_test" || a.timerMode !== "countup" || !Number.isFinite(a.elapsedMs))) return null;
  if (a.schemaVersion === 2 && a.timerMode === "countup") return null;
  if (a.schemaVersion === 2 && a.purpose === "self_test" && !a.legacy && (!Number.isFinite(a.budgetMs) || !Number.isFinite(a.remainingMs))) return null;
  if (Object.values(a.answers).some((r) => !r || typeof r.value !== "string" || !r.eventId || !Number.isFinite(Date.parse(r.at)))) return null;
  if (Object.entries(a.finalizations).some(([id, f]) => !f || f.id !== id || !Number.isFinite(Date.parse(f.at)) || !Array.isArray(f.questions))) return null;
  return a;
}

export interface CetCommitPackage { schemaVersion?: 2 | 3 | 4; id?: string; attemptId: string; finalization: CetFinalization }

export function readCetCommitPackages(storage: Storage = getLearningStorage()): CetCommitPackage[] {
  try {
    const raw = [CET_FINALIZATIONS_KEY, CET_FINALIZATIONS_V3_KEY, CET_FINALIZATIONS_V4_KEY].flatMap((key) => { try { const rows = JSON.parse(storage.getItem(key) || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } });
    return Array.isArray(raw) ? raw.filter((p): p is CetCommitPackage => Boolean(p?.attemptId && p.finalization?.id && Array.isArray(p.finalization.questions))) : [];
  } catch {
    return [];
  }
}

export function writeCetCommitPackages(storage: Storage, items: CetCommitPackage[]): void {
  storage.setItem(CET_FINALIZATIONS_KEY, JSON.stringify(items.filter((p) => !p.schemaVersion || p.schemaVersion === 2)));
  storage.setItem(CET_FINALIZATIONS_V3_KEY, JSON.stringify(items.filter((p) => p.schemaVersion === 3)));
  storage.setItem(CET_FINALIZATIONS_V4_KEY, JSON.stringify(items.filter((p) => p.schemaVersion === 4)));
}

export function readCetActivities(storage: Storage = getLearningStorage()): CetActivity[] {
  try {
    const raw = [CET_ACTIVITIES_KEY, CET_ACTIVITIES_V3_KEY, CET_ACTIVITIES_V4_KEY].flatMap((key) => { try { const rows = JSON.parse(storage.getItem(key) || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } });
    if (!Array.isArray(raw)) return [];
    const commits = readCetCommitPackages(storage);
    const byAttempt = new Map<string, CetCommitPackage[]>();
    for (const item of commits) byAttempt.set(item.attemptId, [...(byAttempt.get(item.attemptId) || []), item]);
    const normalized=raw.map(normalizeCetActivity).filter((a): a is CetActivity => Boolean(a));
    const upgraded = new Set(normalized.filter(a=>a.schemaVersion===4).map(a=>a.id));
    return normalized.filter(a=>a.schemaVersion===4||!upgraded.has(a.id)).map((activity) => {
      if(activity.schemaVersion===4){
        for(const old of normalized.filter(a=>a.id===activity.id&&a.schemaVersion!==4))activity=preserveLegacyCetDraft(activity,old);
      }
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

export function preserveLegacyCetDraft(current:CetActivity,old:CetActivity):CetActivity {
  if(current.schemaVersion!==4||current.id!==old.id||current.owner!==old.owner||current.scopeKey!==old.scopeKey)return current;
  const key=`v${old.schemaVersion}:${old.updatedAt}`;
  const firstAdjustment=Object.values(current.timerEpochs||{}).map(e=>e.at).sort()[0];
  const conflict=firstAdjustment && old.updatedAt>firstAdjustment && JSON.stringify(old.answers)!==JSON.stringify(current.answers);
  return {...current,conditions:[...new Set([...current.conditions,...(conflict?['legacy_draft_conflict']:[])])],legacyDraftRecovery:{...current.legacyDraftRecovery,[key]:old},finalizations:{...old.finalizations,...current.finalizations},
    status:old.status==='submitted'||old.status==='ended'?old.status:current.status};
}
export function writeCetActivities(storage: Storage, items: CetActivity[]): void {
  const upgraded=new Set(items.filter(a=>a.schemaVersion===4).map(a=>a.id));
  const sources=[CET_ACTIVITIES_KEY,CET_ACTIVITIES_V3_KEY].flatMap(k=>{try{return JSON.parse(storage.getItem(k)||'[]') as CetActivity[];}catch{return [];}}).filter(a=>upgraded.has(a.id));
  items=[...sources,...items.filter(a=>!sources.some(s=>s.id===a.id&&s.schemaVersion===a.schemaVersion))];
  storage.setItem(CET_ACTIVITIES_KEY, JSON.stringify(items.filter((a) => a.schemaVersion === 2)));
  storage.setItem(CET_ACTIVITIES_V3_KEY, JSON.stringify(items.filter((a) => a.schemaVersion === 3)));
  storage.setItem(CET_ACTIVITIES_V4_KEY, JSON.stringify(items.filter((a) => a.schemaVersion === 4)));
}

export function saveCetActivity(item: CetActivity, storage: Storage = getLearningStorage()): CetActivity {
  const activityKey = item.schemaVersion === 4 ? CET_ACTIVITIES_V4_KEY : item.schemaVersion === 3 ? CET_ACTIVITIES_V3_KEY : CET_ACTIVITIES_KEY;
  const commitKey = item.schemaVersion === 4 ? CET_FINALIZATIONS_V4_KEY : item.schemaVersion === 3 ? CET_FINALIZATIONS_V3_KEY : CET_FINALIZATIONS_KEY;
  if (isLearningStorage(storage)) {
    const old = normalizeCetActivity(storage.getRecord(activityKey, item.id));
    if (!old && !storage.getItem(activityKey)) storage.setItem(activityKey, "[]");
    const next = mergeCetActivity(old || undefined, item);
    for (const finalization of Object.values(next.finalizations)) {
      const id = `${next.id}:${finalization.id}`;
      if (!storage.getRecord(commitKey, id)) {
        if (!storage.getItem(commitKey)) storage.setItem(commitKey, "[]");
        storage.setRecord(commitKey, id, { id, schemaVersion: next.schemaVersion, attemptId: next.id, finalization });
      }
    }
    storage.setRecord(activityKey, item.id, next);
    notifyAccountDataChanged(["preferences"]);
    return next;
  }
  const all = readCetActivities(storage);
  const old = all.find((a) => a.id === item.id);
  const next = old && old.schemaVersion !== item.schemaVersion
    ? item.schemaVersion === 4 ? preserveLegacyCetDraft(item, old) : old.schemaVersion === 4 ? preserveLegacyCetDraft(old, item) : mergeCetActivity(old, item)
    : mergeCetActivity(old, item);
  const packages = readCetCommitPackages(storage);
  const known = new Set(packages.map((p) => `${p.attemptId}:${p.finalization.id}`));
  const additions = Object.values(next.finalizations)
    .filter((f) => !known.has(`${next.id}:${f.id}`))
    .map((finalization) => ({ schemaVersion: next.schemaVersion, id: `${next.id}:${finalization.id}`, attemptId: next.id, finalization }));
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
