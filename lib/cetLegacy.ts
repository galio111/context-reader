import type { CetActivity, CetAttempt, CetPaper } from "@/types/cet";
import { cetFinalize, createCetActivity } from "@/lib/cetActivity";

export function adaptLegacyCetAttempt(raw: CetAttempt, paper: CetPaper, owner: string): CetActivity {
  const purpose = raw.mode === "exam" ? "self_test" : "practice";
  let activity = createCetActivity({
    paper,
    sectionId: raw.sectionId,
    purpose,
    owner,
    id: `legacy:${raw.id}`,
    now: raw.createdAt,
  });
  activity = {
    ...activity,
    activeSection: activity.sectionIds.includes(raw.activeSection) ? raw.activeSection : activity.activeSection,
    answers: Object.fromEntries(Object.entries(raw.answers).filter(([key]) => activity.questionKeys.includes(key)).map(([key, value]) => [key, {
      value,
      at: raw.answerTimes[key] || raw.updatedAt,
      eventId: `legacy:${raw.id}:${key}`,
    }])),
    updatedAt: raw.updatedAt,
    elapsedMs: raw.elapsedMs,
    timerParts: { ...raw.timerParts },
    budgetMs: undefined,
    remainingMs: undefined,
    runningSince: undefined,
    timerRevision: `${raw.updatedAt}:legacy`,
    sourceAttemptId: raw.id,
    legacy: { sourceId: raw.id, mode: raw.mode, raw, conditionsUnknown: true },
    conditions: ["legacy_conditions_unknown", ...(Object.keys(raw.revealed).length ? ["legacy_early_reveal"] : [])],
  };
  if (raw.finishedAt) {
    if (purpose === "self_test") activity = cetFinalize(activity, paper, "legacy", undefined, raw.finishedAt, `legacy-final:${raw.id}`);
    else for (const sectionId of activity.sectionIds) activity = cetFinalize(activity, paper, "legacy", sectionId, raw.finishedAt, `legacy-final:${raw.id}:${sectionId}`);
    activity = { ...activity, submittedAt: raw.finishedAt, status: "submitted", updatedAt: raw.updatedAt };
  }
  return activity;
}
