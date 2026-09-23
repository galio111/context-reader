import type {
  CetActivity,
  CetAnswerRevision,
  CetFinalization,
  CetFinalizationReason,
  CetPaper,
  CetQuestionSnapshot,
  CetPurpose,
} from "@/types/cet";

export const CET_SELF_TEST_MINUTES = { paper: 40, section: 10 } as const;
export const CET_SELF_TEST_MIN_RANGE = 1;
export const CET_SELF_TEST_MAX_RANGE = 180;

export function cetScopeKey(paperId: string, sectionId?: string): string {
  return sectionId ? `section:${paperId}:${sectionId}` : `paper:${paperId}`;
}

export function cetQuestionKey(sectionId: string, number: number): string {
  return `${sectionId}:${number}`;
}

export function cetPracticeSectionElapsedMs(activity: CetActivity, sectionId: string): number {
  const prefix = `${sectionId}#`;
  return Object.entries(activity.timerParts).reduce((total, [id, ms]) => total + (id.startsWith(prefix) ? ms : 0), 0);
}

export function cetHistoryLabel(activity: CetActivity): string {
  const legacy = activity.legacy ? "旧版 · " : "";
  if (activity.status === "ended") return `${legacy}未完成结束 · 查看记录`;
  if (activity.status === "submitted") return `${legacy}已完成 · 查看结果`;
  if (activity.status === "paused") return `${legacy}已暂停 · 继续自测`;
  if (activity.purpose === "self_test") return `${legacy}进行中 · 继续自测`;
  const count = activity.sectionIds.filter((id) => cetFinalizedSection(activity, id)).length;
  return `${legacy}已完成 ${count}/${activity.sectionIds.length} 篇 · 继续练习`;
}

// Small synchronous content fingerprint. It is a version marker, not a security hash.
export function cetContentVersion(paper: CetPaper, sectionIds: string[]): string {
  const source = JSON.stringify(paper.sections.filter((s) => sectionIds.includes(s.id)));
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function cetQuestionSnapshots(paper: CetPaper, sectionIds: string[]): CetQuestionSnapshot[] {
  return paper.sections
    .filter((s) => sectionIds.includes(s.id))
    .flatMap((s) => s.questions.map((q) => ({
      key: cetQuestionKey(s.id, q.number),
      sectionId: s.id,
      number: q.number,
      stem: q.stem,
      options: q.options.map((o) => ({ ...o })),
      answer: q.answer,
      explanation: q.explanation,
    })));
}

export function createCetActivity(input: {
  paper: CetPaper;
  sectionId?: string;
  purpose: CetPurpose;
  owner: string;
  minutes?: number;
  knownPriorSectionIds?: string[];
  sourceAttemptId?: string;
  id?: string;
  now?: string;
}): CetActivity {
  const { paper, sectionId, purpose, owner } = input;
  const sections = sectionId ? paper.sections.filter((s) => s.id === sectionId) : paper.sections;
  if (!sections.length || (sectionId && sections.length !== 1)) throw new Error("阅读材料不存在。 ");
  const now = input.now || new Date().toISOString();
  const minutes = input.minutes ?? CET_SELF_TEST_MINUTES[sectionId ? "section" : "paper"];
  if (purpose === "self_test" && (!Number.isInteger(minutes) || minutes < CET_SELF_TEST_MIN_RANGE || minutes > CET_SELF_TEST_MAX_RANGE)) {
    throw new Error("自测时长须为 1–180 分钟。");
  }
  const sectionIds = sections.map((s) => s.id);
  const budgetMs = purpose === "self_test" ? minutes * 60_000 : undefined;
  return {
    schemaVersion: 2,
    id: input.id || crypto.randomUUID(),
    owner,
    purpose,
    paperId: paper.id,
    sectionId,
    scopeKey: cetScopeKey(paper.id, sectionId),
    sectionIds,
    questionKeys: sections.flatMap((s) => s.questions.map((q) => cetQuestionKey(s.id, q.number))),
    contentVersion: cetContentVersion(paper, sectionIds),
    title: sectionId ? `${paper.title} · ${sections[0].title}` : paper.title,
    activeSection: sections[0].id,
    status: "in_progress",
    answers: {},
    finalizations: {},
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    budgetMs,
    runningSince: purpose === "self_test" ? now : undefined,
    remainingMs: budgetMs,
    timerRevision: `${now}:start`,
    everPaused: false,
    elapsedMs: 0,
    timerParts: {},
    sourceAttemptId: input.sourceAttemptId,
    knownPriorSectionIds: [...new Set(input.knownPriorSectionIds || [])].sort(),
    conditions: [],
  };
}

export function cetRemainingMs(activity: CetActivity, now = Date.now()): number {
  if (activity.purpose !== "self_test") return 0;
  if (activity.legacy) return Number.POSITIVE_INFINITY;
  const remaining = activity.remainingMs ?? activity.budgetMs ?? 0;
  if (!activity.runningSince || activity.status !== "in_progress") return Math.max(0, remaining);
  return Math.max(0, remaining - Math.max(0, now - Date.parse(activity.runningSince)));
}

export function cetTimingAnomaly(activity: CetActivity, now = Date.now()): boolean {
  if (activity.purpose !== "self_test" || activity.legacy) return false;
  return !Number.isFinite(now) || now + 5000 < Date.parse(activity.startedAt)
    || Boolean(activity.runningSince && now + 5000 < Date.parse(activity.runningSince));
}

export function cetAnswer(activity: CetActivity, key: string, value: string, now = new Date().toISOString(), eventId = crypto.randomUUID()): CetActivity {
  if (activity.status !== "in_progress" || !activity.questionKeys.includes(key)) return activity;
  if (activity.purpose === "practice" && Object.values(activity.finalizations).some((f) => f.sectionId && key.startsWith(`${f.sectionId}:`))) return activity;
  if (activity.purpose === "self_test" && cetRemainingMs(activity, Date.parse(now)) === 0) return activity;
  const previous = activity.answers[key];
  if (previous?.value === value) return activity;
  return {
    ...activity,
    answers: { ...activity.answers, [key]: { value, at: now, eventId } },
    updatedAt: now,
    lastAnsweredAt: now,
  };
}

export function cetPause(activity: CetActivity, now = new Date().toISOString(), eventId = crypto.randomUUID()): CetActivity {
  if (activity.purpose !== "self_test" || activity.status !== "in_progress") return activity;
  return {
    ...activity,
    status: "paused",
    remainingMs: activity.legacy ? undefined : cetRemainingMs(activity, Date.parse(now)),
    runningSince: undefined,
    timerRevision: `${now}:${eventId}`,
    everPaused: true,
    conditions: cetTimingAnomaly(activity, Date.parse(now)) ? [...new Set([...activity.conditions, "timing_anomaly"])] : activity.conditions,
    updatedAt: now,
  };
}

export function cetResume(activity: CetActivity, now = new Date().toISOString(), eventId = crypto.randomUUID()): CetActivity {
  if (activity.purpose !== "self_test" || activity.status !== "paused") return activity;
  return {
    ...activity,
    status: "in_progress",
    runningSince: activity.legacy ? undefined : now,
    timerRevision: `${now}:${eventId}`,
    everPaused: true,
    conditions: cetTimingAnomaly(activity, Date.parse(now)) ? [...new Set([...activity.conditions, "timing_anomaly"])] : activity.conditions,
    updatedAt: now,
  };
}

export function cetFinalizedSection(activity: CetActivity, sectionId: string): CetFinalization | undefined {
  return Object.values(activity.finalizations).find((f) => f.sectionId === sectionId);
}

export function cetFinalize(activity: CetActivity, paper: CetPaper, reason: CetFinalizationReason, sectionId?: string, now = new Date().toISOString(), id = crypto.randomUUID()): CetActivity {
  const isPractice = activity.purpose === "practice";
  if (isPractice !== Boolean(sectionId)) throw new Error("提交范围与活动目标不一致。");
  if (activity.status === "submitted" || activity.status === "ended") return activity;
  if (isPractice && (!activity.sectionIds.includes(sectionId!) || cetFinalizedSection(activity, sectionId!))) return activity;
  if (!isPractice && activity.status !== "in_progress" && activity.status !== "paused") return activity;
  const sectionIds = sectionId ? [sectionId] : activity.sectionIds;
  const questions = cetQuestionSnapshots(paper, sectionIds);
  const answers = Object.fromEntries(questions.map((q) => [q.key, activity.answers[q.key]?.value || ""]));
  const scoreable = questions.filter((q) => q.answer && q.options.some((o) => o.key === q.answer)).length;
  const correct = questions.filter((q) => q.answer && q.options.some((o) => o.key === q.answer) && answers[q.key] === q.answer).length;
  const unanswered = questions.filter((q) => !answers[q.key]).length;
  const elapsedMs = activity.legacy ? activity.elapsedMs : activity.purpose === "self_test"
    ? Math.max(0, (activity.budgetMs || 0) - cetRemainingMs(activity, Date.parse(now)))
    : cetPracticeSectionElapsedMs(activity, sectionId!);
  const finalization: CetFinalization = {
    id,
    sectionId,
    reason,
    at: now,
    answers,
    questions,
    contentVersion: activity.contentVersion,
    answerVersion: activity.contentVersion,
    correct,
    scoreable,
    unanswered,
    unreliable: questions.length - scoreable,
    elapsedMs,
    everPaused: activity.everPaused,
    conditions: [...new Set([...activity.conditions, ...(activity.knownPriorSectionIds.length ? ["prior_material"] : []), ...(cetTimingAnomaly(activity, Date.parse(now)) ? ["timing_anomaly"] : [])])],
  };
  const finalizations = { ...activity.finalizations, [id]: finalization };
  const allPracticeDone = isPractice && activity.sectionIds.every((s) => Object.values(finalizations).some((f) => f.sectionId === s));
  const ended = reason === "ended_for_study";
  return {
    ...activity,
    finalizations,
    status: ended ? "ended" : !isPractice || allPracticeDone ? "submitted" : "in_progress",
    submittedAt: ended ? activity.submittedAt : !isPractice || allPracticeDone ? now : activity.submittedAt,
    endedAt: ended ? now : activity.endedAt,
    remainingMs: activity.purpose === "self_test" && !activity.legacy ? cetRemainingMs(activity, Date.parse(now)) : activity.remainingMs,
    runningSince: undefined,
    elapsedMs: activity.purpose === "practice" ? activity.elapsedMs : elapsedMs,
    conditions: finalization.conditions,
    updatedAt: now,
  };
}

function laterRevision(a?: CetAnswerRevision, b?: CetAnswerRevision): CetAnswerRevision | undefined {
  if (!a) return b;
  if (!b) return a;
  const ak = `${a.at}\u0000${a.eventId}\u0000${a.value}`;
  const bk = `${b.at}\u0000${b.eventId}\u0000${b.value}`;
  return ak >= bk ? a : b;
}

function stableWinner<T>(a: T, b: T): T {
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeCetActivity(a: CetActivity | undefined, b: CetActivity): CetActivity {
  if (!a) return b;
  if (a.id !== b.id || a.owner !== b.owner || a.purpose !== b.purpose || a.scopeKey !== b.scopeKey || a.contentVersion !== b.contentVersion) {
    throw new Error("四六级活动身份冲突，原记录已保留。");
  }
  const answers: CetActivity["answers"] = {};
  for (const key of new Set([...Object.keys(a.answers), ...Object.keys(b.answers)])) {
    const revision = laterRevision(a.answers[key], b.answers[key]);
    if (revision) answers[key] = revision;
  }
  const finalizations = { ...a.finalizations };
  for (const [id, snapshot] of Object.entries(b.finalizations)) {
    finalizations[id] = finalizations[id] ? stableWinner(finalizations[id], snapshot) : snapshot;
  }
  const timer = a.timerRevision > b.timerRevision ? a : b.timerRevision > a.timerRevision ? b : stableWinner(a, b);
  const latest = a.updatedAt > b.updatedAt ? a : b.updatedAt > a.updatedAt ? b : stableWinner(a, b);
  const timerParts = { ...a.timerParts };
  for (const [key, ms] of Object.entries(b.timerParts)) timerParts[key] = Math.max(timerParts[key] || 0, ms);
  const snapshots = Object.values(finalizations);
  const submittedTimes = snapshots.filter((f) => f.reason !== "ended_for_study").map((f) => f.at).sort();
  const endedTimes = snapshots.filter((f) => f.reason === "ended_for_study").map((f) => f.at).sort();
  const hasConflict = new Set(snapshots.map((f) => f.sectionId || "$self_test")).size < snapshots.length;
  const status = snapshots.some((f) => f.reason === "ended_for_study") ? "ended"
    : a.purpose === "self_test" && snapshots.length ? "submitted"
      : a.purpose === "practice" && a.sectionIds.every((s) => snapshots.some((f) => f.sectionId === s)) ? "submitted"
        : timer.status === "paused" ? "paused" : "in_progress";
  const merged: CetActivity = {
    ...latest,
    answers,
    finalizations,
    status,
    activeSection: latest.activeSection,
    everPaused: a.everPaused || b.everPaused,
    timerRevision: timer.timerRevision,
    runningSince: status === "in_progress" ? timer.runningSince : undefined,
    remainingMs: timer.remainingMs,
    timerParts,
    elapsedMs: a.purpose === "practice" ? Object.values(timerParts).reduce((sum, ms) => sum + ms, 0) : timer.elapsedMs,
    knownPriorSectionIds: [...new Set([...a.knownPriorSectionIds, ...b.knownPriorSectionIds])].sort(),
    conditions: [...new Set([...a.conditions, ...b.conditions, ...(hasConflict ? ["submission_conflict"] : [])])].sort(),
    submittedAt: submittedTimes.length && (a.purpose === "self_test" || status === "submitted") ? submittedTimes.at(-1) : undefined,
    endedAt: endedTimes[0],
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
  if (!merged.submittedAt) delete merged.submittedAt;
  if (!merged.endedAt) delete merged.endedAt;
  return merged;
}

export function cetEligibility(activity: CetActivity, observedConditions: string[] = []): "first_site_test" | "repeat_test" | "conditions_incomplete" | "not_comparable" {
  if (activity.purpose !== "self_test" || activity.status !== "submitted") return "not_comparable";
  if (activity.legacy || activity.conditions.includes("submission_conflict") || activity.conditions.includes("timing_anomaly") || activity.everPaused || activity.conditions.includes("assistance_during_test") || observedConditions.includes("assistance_during_test") || observedConditions.includes("answer_view_during_test")) return "conditions_incomplete";
  return activity.knownPriorSectionIds.length ? "repeat_test" : "first_site_test";
}
