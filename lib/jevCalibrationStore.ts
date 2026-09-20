import { createHash } from "node:crypto";
import { readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { editorialBudgetDay } from "@/lib/editorialBudget";
import { JEV_CALIBRATION_VERSION, evaluateJevSamples, type JevSample } from "@/lib/jevCalibration";
import { EDITORIAL_POLICY_VERSION } from "@/lib/editorialReviewPolicy";

export const JEV_ADOPTION_KEY = "recommendation_jev_adoption_v1";
export const readJevSamples = (day: string) => readDiscoverySetting<JevSample[]>(`recommendation_jev_samples_${day}`, []);
/** All production callers hold the discovery lease. Deduplicate by article URL, not chunks/retries. */
export async function recordJevSample(url: string, sample: Omit<JevSample, "id" | "source">, fallbackId: string) {
  const day = editorialBudgetDay();
  if (!day) return;
  const samples = await readJevSamples(day);
  const id = createHash("sha256").update(url || fallbackId).digest("hex");
  let source = "unknown";
  try { source = new URL(url).hostname; } catch { /* No invented source diversity. */ }
  const next = [...samples.filter(previous => previous.id !== id), { ...sample, id, source }].slice(-2000);
  await writeDiscoverySetting(`recommendation_jev_samples_${day}`, next);
}
export async function finalizeJevCalibration(day: string, complete: boolean, autoAdopt: boolean) {
  const stats = evaluateJevSamples(await readJevSamples(day));
  if (autoAdopt && complete) await writeDiscoverySetting(JEV_ADOPTION_KEY, {
    sampleDay: day, version: JEV_CALIBRATION_VERSION, policyVersion: EDITORIAL_POLICY_VERSION,
    approvedChecks: stats.filter(stat => stat.approved).map(stat => stat.key), completed: true,
  });
  return stats;
}
