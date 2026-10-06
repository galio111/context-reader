export type IntakeOutcome = 'technical_pending' | 'content_rejected' | 'policy_skipped';
export type IntakeStage = 'discovery' | 'import' | 'extraction' | 'images' | 'review' | 'storage';
export type IntakeState = 'waiting' | 'retry' | 'attention' | 'rejected' | 'skipped' | 'candidate';
export interface IntakeEntry {
  url: string; title: string; description: string; publishedAt: string;
  firstSeenAt: string; updatedAt: string; state: IntakeState; attempts: number;
  stage?: IntakeStage; reason?: string; nextAttemptAt?: string; candidateId?: string;
}
export class EditorialIntakeError extends Error {
  constructor(message: string, readonly outcome: IntakeOutcome, readonly needsAttention = false) { super(message); }
}
/** Unexpected exceptions always remain technical work, never a content verdict. */
export function intakeFailure(error: unknown) {
  return {
    kind: error instanceof EditorialIntakeError ? error.outcome : 'technical_pending' as IntakeOutcome,
    needsAttention: error instanceof EditorialIntakeError && error.needsAttention,
    reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}
export function applyIntakeFailure(entry: IntakeEntry, error: unknown, stage: IntakeStage, now = Date.now()): IntakeEntry {
  const failure = intakeFailure(error), attempts = entry.attempts + 1;
  const state: IntakeState = failure.kind === 'content_rejected' ? 'rejected' : failure.kind === 'policy_skipped' ? 'skipped'
    : failure.needsAttention || attempts >= 3 ? 'attention' : 'retry';
  return { ...entry, state, attempts, stage, reason: failure.reason, updatedAt: new Date(now).toISOString(),
    nextAttemptAt: state === 'retry' ? new Date(now + (attempts === 1 ? 1 : 6) * 3600_000).toISOString() : undefined };
}
export function intakeDue(entry: IntakeEntry, now = Date.now()) {
  return entry.state === 'waiting' || entry.state === 'retry' && Date.parse(entry.nextAttemptAt || '') <= now;
}
