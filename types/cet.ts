export type CetType = "cloze" | "matching" | "detail";
export interface CetQuestion {
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string;
  explanation?: string;
}
export interface CetSection {
  id: string;
  materialId?: string;
  questionSetId?: string;
  type: CetType;
  title: string;
  paragraphs: string[];
  questions: CetQuestion[];
  bank?: { key: string; text: string }[];
}
export interface CetPaper {
  id: string;
  level: 4 | 6;
  year: number;
  month: number;
  set: number;
  title: string;
  source: string;
  answerSource?: string;
  status: "ready" | "review";
  sections: CetSection[];
}
export interface CetAttempt {
  id: string;
  scope: string;
  paperId: string;
  sectionId?: string;
  activeSection: string;
  title: string;
  mode: "exam" | "study";
  answers: Record<string, string>;
  answerTimes: Record<string, string>;
  revealed: Record<string, string>;
  elapsedMs: number;
  timerEpoch: string;
  timerParts: Record<string, number>;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// The v1 attempt above is retained verbatim for old browsers and honest history
// migration. New work uses a separate identity and never changes its purpose.
export type CetPurpose = "practice" | "self_test";
export type CetActivityStatus = "in_progress" | "paused" | "submitted" | "ended";
export type CetFinalizationReason = "passage_submit" | "manual_submit" | "time_expired" | "ended_for_study" | "legacy";
export interface CetAnswerRevision {
  value: string;
  at: string;
  eventId: string;
}
export interface CetQuestionSnapshot {
  key: string;
  sectionId: string;
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string;
  explanation?: string;
}
export interface CetFinalization {
  timerMode?: "countdown" | "countup";
  id: string;
  sectionId?: string;
  reason: CetFinalizationReason;
  at: string;
  answers: Record<string, string>;
  questions: CetQuestionSnapshot[];
  contentVersion: string;
  answerVersion: string;
  correct: number;
  scoreable: number;
  unanswered: number;
  unreliable: number;
  elapsedMs: number;
  everPaused: boolean;
  conditions: string[];
}
export interface CetActivity {
  schemaVersion: 2 | 3;
  timerMode?: "countdown" | "countup";
  practiceTimerPaused?: boolean;
  id: string;
  owner: string;
  purpose: CetPurpose;
  paperId: string;
  sectionId?: string;
  scopeKey: string;
  sectionIds: string[];
  questionKeys: string[];
  contentVersion: string;
  title: string;
  activeSection: string;
  status: CetActivityStatus;
  answers: Record<string, CetAnswerRevision>;
  finalizations: Record<string, CetFinalization>;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  lastAnsweredAt?: string;
  submittedAt?: string;
  endedAt?: string;
  budgetMs?: number;
  runningSince?: string;
  remainingMs?: number;
  timerRevision: string;
  everPaused: boolean;
  elapsedMs: number;
  timerParts: Record<string, number>;
  sourceAttemptId?: string;
  legacy?: { sourceId: string; mode: "exam" | "study"; raw: CetAttempt; conditionsUnknown: true };
  knownPriorSectionIds: string[];
  conditions: string[];
}

export interface CetExposure {
  schemaVersion: 2;
  id: string;
  owner: string;
  paperId: string;
  sectionId: string;
  materialId: string;
  questionSetId?: string;
  kind: "read" | "answer" | "assist" | "answer_view";
  occurredAt: string;
  attemptId?: string;
}
