"use client";

import { getLearningStorage } from "@/lib/learningStorage";
import { notifyAccountDataChanged } from "@/lib/accountEvents";
import { emptyRecommendationPreferences, normalizeRecommendationPreferences, RECOMMENDATION_PREFERENCES_STORAGE_KEY, RECOMMENDATION_PREFERENCES_CHANGED_EVENT, type RecommendationPreferences } from "@/lib/recommendationPreferencesShared";
export * from "@/lib/recommendationPreferencesShared";

export function readRecommendationPreferences(storage?: Storage): RecommendationPreferences {
  if (!storage && typeof window === "undefined") return emptyRecommendationPreferences();
  const source = storage ?? getLearningStorage();
  try {
    return normalizeRecommendationPreferences(JSON.parse(source.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY) || "null"));
  } catch {
    return emptyRecommendationPreferences();
  }
}

export function writeRecommendationPreferences(
  input: Pick<RecommendationPreferences, "readingLevel" | "interests">,
  options: { authenticated: boolean },
): RecommendationPreferences {
  const next = normalizeRecommendationPreferences({
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
    scope: options.authenticated ? "account" : "guest",
  });
  getLearningStorage().setItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(RECOMMENDATION_PREFERENCES_CHANGED_EVENT, { detail: next }));
  if (options.authenticated) notifyAccountDataChanged(["preferences"]);
  return next;
}

export function writeRecommendationPreferencesFromSync(storage: Storage, input: unknown): RecommendationPreferences {
  const next = normalizeRecommendationPreferences({ ...(input as Record<string, unknown>), scope: "account" });
  storage.setItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

