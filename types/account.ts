export type AccountPlanId = "guest" | "free" | "basic" | "plus" | "max" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";
export type GuestUsageMetricKey =
  | "guest_article_lookup"
  | "guest_dictionary_lookup"
  | "guest_text_import"
  | "guest_url_import";
/** Server-managed metric keys are extensible; guest-facing product rules use the stricter subtype above. */
export type UsageMetricKey = string;

export interface AccountProfile {
  userId: string;
  email: string;
  phone: string;
  loginMethod: "email" | "phone_pin";
  phoneVerified: boolean;
  nickname: string;
  avatarUrl: string;
  englishLevel: string;
  learningGoal: string;
  /** Optional for compatibility with pre-profile snapshots and offline artifacts. */
  readingInterests?: string[];
  birthYear?: number | null;
  gender?: "male" | "female" | null;
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
  /** True only for the loopback-only development identity; never a cloud account. */
  localOnly?: boolean;
  /** True when localhost is pinned to a real, server-verified cloud account. */
  localDirect?: boolean;
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
