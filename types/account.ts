export type AccountPlanId = "guest" | "free" | "basic" | "plus" | "max" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";
export type UsageMetricKey = "guest_lookup" | "lookup_generation" | "deep_reading";

export interface AccountProfile {
  userId: string;
  email: string;
  nickname: string;
  avatarUrl: string;
  englishLevel: string;
  learningGoal: string;
  status: AccountStatus;
}

export interface AccountPlanLimit {
  metricKey: UsageMetricKey;
  allowance: number;
  windowType: "day" | "month";
}

export interface AccountPlan {
  id: AccountPlanId;
  displayName: string;
  priceCny: number;
  active: boolean;
  limits: AccountPlanLimit[];
}

export interface UsageBalance {
  metricKey: UsageMetricKey;
  used: number;
  allowance: number;
  remaining: number;
  windowEnd: string;
}

export interface AccountSessionState {
  configured: boolean;
  authenticated: boolean;
  profile: AccountProfile | null;
  plan: AccountPlan | null;
  usage: UsageBalance[];
}

export interface UsageReservation {
  allowed: boolean;
  used: number;
  allowance: number;
  remaining: number;
  windowEnd: string;
  duplicate: boolean;
  actionId: string;
  metricKey: UsageMetricKey;
}

export type SyncObjectKind =
  | "article"
  | "vocabulary"
  | "explanation"
  | "article_translation"
  | "translation_block"
  | "reading_state"
  | "preferences";

export interface AccountSyncObject {
  kind: SyncObjectKind;
  objectKey: string;
  payload: unknown;
  clientUpdatedAt: string;
  serverVersion: number;
  deletedAt?: string;
}

export interface AccountSyncWriteResult extends AccountSyncObject {
  accepted: boolean;
}
