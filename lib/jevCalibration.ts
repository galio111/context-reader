import { EDITORIAL_QUESTIONS, EDITORIAL_POLICY_VERSION, type EditorialCheck, type EditorialDecisions } from "@/lib/editorialReviewPolicy";

export const JEV_CALIBRATION_VERSION = 1;
export const JEV_CHECKS = Object.keys(EDITORIAL_QUESTIONS) as EditorialCheck[];
export const JEV_LABELS: Record<EditorialCheck, string> = { incomplete: "正文完整性", contamination: "非正文杂质", orphanCaption: "图注缺图", mediaDependent: "视频/媒体依赖", promotional: "广告宣传" };
export interface JevSample { id: string; source: string; probabilities: Partial<Record<EditorialCheck, number>>; reference: EditorialDecisions; certain: boolean }
export function jevDecision(probability: unknown): boolean | null {
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
  return probability <= 0.05 ? false : probability >= 0.95 ? true : null;
}
export function evaluateJevSamples(samples: JevSample[]) {
  const unique = [...new Map(samples.map(sample => [sample.id, sample])).values()];
  return JEV_CHECKS.map(key => {
    let paired = 0, decided = 0, agree = 0, falseNegative = 0, falsePositive = 0, positives = 0, negatives = 0;
    const sources = new Set<string>();
    for (const sample of unique) {
      const p = sample.probabilities[key];
      if (!sample.certain || typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1 || typeof sample.reference[key] !== "boolean") continue;
      paired++;
      const decision = jevDecision(p);
      if (decision === null) continue;
      decided++;
      sources.add(sample.source);
      if (sample.reference[key]) positives++; else negatives++;
      if (decision === sample.reference[key]) agree++;
      else if (sample.reference[key]) falseNegative++; else falsePositive++;
    }
    const agreement = decided ? agree / decided : null;
    const coverage = paired ? decided / paired : 0;
    const approved = decided >= 35 && positives >= 5 && negatives >= 20 && sources.size >= 3 && coverage >= 0.8 && agreement !== null && agreement >= 0.95 && falseNegative === 0 && falsePositive <= 1;
    return { key, paired, decided, agree, agreement, coverage, falseNegative, falsePositive, positives, negatives, sources: sources.size, approved };
  });
}
export interface JevAdoption { sampleDay: string; version: number; policyVersion: number; approvedChecks: EditorialCheck[]; completed: boolean }
export function adoptedJevChecks(value: JevAdoption | null, day: string): EditorialCheck[] {
  if (!value?.completed || value.version !== JEV_CALIBRATION_VERSION || value.policyVersion !== EDITORIAL_POLICY_VERSION || !/^\d{4}-\d{2}-\d{2}$/.test(value.sampleDay) || day <= value.sampleDay) return [];
  return JEV_CHECKS.filter(key => value.approvedChecks?.includes(key));
}
