"use client";

import type { CetActivity, CetExposure, CetSection } from "@/types/cet";
import { getLearningStorage, isLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";

export const CET_EXPOSURES_KEY = "context-reader:cet-exposures:v2";
export const CET_EXPOSURE_OBJECT_PREFIX = "cet-exposure:v2:";

export function normalizeCetExposure(value: unknown): CetExposure | null {
  if (!value || typeof value !== "object") return null;
  const event = value as CetExposure;
  if (event.schemaVersion !== 2 || !event.id || !event.owner || !event.paperId || !event.sectionId || !event.materialId
    || !["read", "answer", "assist", "answer_view"].includes(event.kind)
    || !Number.isFinite(Date.parse(event.occurredAt))) return null;
  return event;
}

export function readCetExposures(storage: Storage = getLearningStorage()): CetExposure[] {
  try {
    const raw = JSON.parse(storage.getItem(CET_EXPOSURES_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(normalizeCetExposure).filter((event): event is CetExposure => Boolean(event)) : [];
  } catch { return []; }
}

export function writeCetExposures(storage: Storage, events: CetExposure[]): void {
  storage.setItem(CET_EXPOSURES_KEY, JSON.stringify(events));
}

export function saveCetExposure(event: CetExposure, storage: Storage = getLearningStorage()): void {
  if (isLearningStorage(storage)) {
    if (storage.getRecord(CET_EXPOSURES_KEY, event.id)) return;
    if (!storage.getItem(CET_EXPOSURES_KEY)) storage.setItem(CET_EXPOSURES_KEY, "[]");
    storage.setRecord(CET_EXPOSURES_KEY, event.id, event);
    notifyAccountDataChanged(["preferences"]);
    return;
  }
  const old = readCetExposures(storage);
  if (old.some((item) => item.id === event.id)) return;
  writeCetExposures(storage, [...old, event]);
  notifyAccountDataChanged(["preferences"]);
}

export function exposureFor(section: CetSection, paperId: string, owner: string, kind: CetExposure["kind"], id: string, attemptId?: string, occurredAt = new Date().toISOString()): CetExposure {
  return { schemaVersion: 2, id, owner, paperId, sectionId: section.id, materialId: section.materialId || section.id, questionSetId: section.questionSetId, kind, attemptId, occurredAt };
}

export function priorCetSections(sections: CetSection[], events: CetExposure[], at: string, owner: string): string[] {
  const knownMaterials = new Set(events.filter((event) => event.owner === owner && event.occurredAt < at).map((event) => event.materialId));
  return sections.filter((section) => knownMaterials.has(section.materialId || section.id)).map((section) => section.id);
}

export function cetObservedConditions(activity: CetActivity, sections: CetSection[], events: CetExposure[]): string[] {
  const final = Object.values(activity.finalizations).find((item) => !item.sectionId) || Object.values(activity.finalizations)[0];
  if (!final) return [];
  const materialIds = new Set(sections.filter((section) => activity.sectionIds.includes(section.id)).map((section) => section.materialId || section.id));
  const during = events.filter((event) => event.owner === activity.owner && event.attemptId !== activity.id
    && materialIds.has(event.materialId) && event.occurredAt > activity.startedAt && event.occurredAt < final.at);
  const conditions: string[] = [];
  if (during.some((event) => event.kind === "answer_view")) conditions.push("answer_view_during_test");
  if (during.some((event) => event.kind === "assist")) conditions.push("assistance_during_test");
  return conditions;
}
