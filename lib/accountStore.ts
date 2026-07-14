import type { User } from "@supabase/supabase-js";
import type {
  AccountPlan,
  AccountPlanId,
  AccountProfile,
  AccountSessionState,
  AccountSyncObject,
  AccountSyncWriteResult,
  UsageBalance,
  UsageMetricKey,
  UsageReservation,
} from "@/types/account";

interface ProfileRow {
  user_id: string;
  nickname: string;
  avatar_url: string;
  english_level: string;
  learning_goal: string;
  status: AccountProfile["status"];
}

interface EntitlementRow {
  plan_id: AccountPlanId;
  ends_at: string | null;
}

interface PlanRow {
  id: AccountPlanId;
  display_name: string;
  price_cny: number;
  active: boolean;
}

interface LimitRow {
  plan_id: AccountPlanId;
  metric_key: UsageMetricKey;
  allowance: number;
  window_type: "day" | "month";
}

interface CounterRow {
  metric_key: UsageMetricKey;
  used_units: number;
  window_end: string;
}

interface SyncObjectRow {
  kind: AccountSyncObject["kind"];
  object_key: string;
  payload: unknown;
  client_updated_at: string;
  server_version: number;
  deleted_at: string | null;
}

function serviceConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Account service is not configured.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

export async function accountFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = serviceConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string; hint?: string } | null;
    throw new Error(data?.message || data?.hint || `Account database request failed with ${response.status}.`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined as T;
  }
  return JSON.parse(responseText) as T;
}

async function ensureAccountRows(user: User): Promise<void> {
  const nickname = String(user.user_metadata?.nickname ?? user.email?.split("@", 1)[0] ?? "").slice(0, 80);
  await Promise.all([
    accountFetch("account_profiles?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify([{ user_id: user.id, email: user.email ?? "", nickname }]),
    }),
    accountFetch("user_entitlements?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify([{ user_id: user.id, plan_id: "free", source: "signup" }]),
    }),
  ]);
}

export async function getAccountPlan(planId: AccountPlanId): Promise<AccountPlan> {
  const [planRows, limitRows] = await Promise.all([
    accountFetch<PlanRow[]>(
      `quota_plans?id=eq.${encodeURIComponent(planId)}&select=id,display_name,price_cny,active&limit=1`,
    ),
    accountFetch<LimitRow[]>(
      `quota_plan_limits?plan_id=eq.${encodeURIComponent(planId)}&select=plan_id,metric_key,allowance,window_type`,
    ),
  ]);
  const row = planRows[0];
  if (!row) {
    throw new Error(`Unknown quota plan: ${planId}`);
  }
  return {
    id: row.id,
    displayName: row.display_name,
    priceCny: row.price_cny,
    active: row.active,
    limits: limitRows.map((limit) => ({
      metricKey: limit.metric_key,
      allowance: Number(limit.allowance),
      windowType: limit.window_type,
    })),
  };
}

export async function getUserPlanId(userId: string): Promise<AccountPlanId> {
  const rows = await accountFetch<EntitlementRow[]>(
    `user_entitlements?user_id=eq.${encodeURIComponent(userId)}&select=plan_id,ends_at&limit=1`,
  );
  const entitlement = rows[0];
  if (!entitlement || (entitlement.ends_at && Date.parse(entitlement.ends_at) <= Date.now())) {
    return "free";
  }
  return entitlement.plan_id;
}

function profileFromRow(row: ProfileRow, email: string): AccountProfile {
  return {
    userId: row.user_id,
    email,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    englishLevel: row.english_level,
    learningGoal: row.learning_goal,
    status: row.status,
  };
}

export async function getUsageBalances(ownerKey: string, plan: AccountPlan): Promise<UsageBalance[]> {
  const now = new Date().toISOString();
  const userId = ownerKey.startsWith("user:") ? ownerKey.slice(5) : "";
  const [rows, bonusRows] = await Promise.all([
    accountFetch<CounterRow[]>(`usage_counters?owner_key=eq.${encodeURIComponent(ownerKey)}&window_end=gt.${encodeURIComponent(now)}&select=metric_key,used_units,window_end`),
    userId ? accountFetch<Array<{ bonus_limits: Record<string, number> }>>(`user_entitlements?user_id=eq.${encodeURIComponent(userId)}&select=bonus_limits&limit=1`) : Promise.resolve([]),
  ]);
  const bonuses = bonusRows[0]?.bonus_limits ?? {};
  const counterByMetric = new Map(rows.map((row) => [row.metric_key, row]));
  return plan.limits.map((limit) => {
    const counter = counterByMetric.get(limit.metricKey);
    const used = Number(counter?.used_units ?? 0);
    const allowance = limit.allowance + Math.max(0, Number(bonuses[limit.metricKey] ?? 0));
    return {
      metricKey: limit.metricKey,
      used,
      allowance,
      remaining: Math.max(0, allowance - used),
      windowEnd: counter?.window_end ?? "",
    };
  });
}

export async function getAccountSessionState(user: User): Promise<AccountSessionState> {
  await ensureAccountRows(user);
  const [profiles, planId] = await Promise.all([
    accountFetch<ProfileRow[]>(
      `account_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,nickname,avatar_url,english_level,learning_goal,status&limit=1`,
    ),
    getUserPlanId(user.id),
  ]);
  const profile = profiles[0];
  if (!profile) {
    throw new Error("Account profile was not created.");
  }
  const plan = await getAccountPlan(planId);
  const usage = await getUsageBalances(`user:${user.id}`, plan);
  return {
    configured: true,
    authenticated: true,
    profile: profileFromRow(profile, user.email ?? ""),
    plan,
    usage,
  };
}

export async function reserveUsage(args: {
  actionId: string;
  ownerKey: string;
  userId?: string;
  guestId?: string;
  planId: AccountPlanId;
  feature: string;
  metricKey: UsageMetricKey;
  units: number;
}): Promise<UsageReservation> {
  const rows = await accountFetch<Array<{
    allowed: boolean;
    used_units: number;
    allowance: number;
    window_end: string;
    duplicate: boolean;
  }>>("rpc/consume_usage", {
    method: "POST",
    body: JSON.stringify({
      p_action_id: args.actionId,
      p_owner_key: args.ownerKey,
      p_user_id: args.userId ?? null,
      p_guest_id: args.guestId ?? null,
      p_plan_id: args.planId,
      p_feature: args.feature,
      p_metric_key: args.metricKey,
      p_units: Math.max(0, Math.floor(args.units)),
    }),
  });
  const row = rows[0] ?? { allowed: false, used_units: 0, allowance: 0, window_end: "", duplicate: false };
  return {
    allowed: row.allowed,
    used: Number(row.used_units),
    allowance: Number(row.allowance),
    remaining: Math.max(0, Number(row.allowance) - Number(row.used_units)),
    windowEnd: row.window_end,
    duplicate: row.duplicate,
    actionId: args.actionId,
    metricKey: args.metricKey,
  };
}

export async function finishUsage(actionId: string, status: "succeeded" | "cached", cacheHit = false): Promise<void> {
  await accountFetch("rpc/finalize_usage", {
    method: "POST",
    body: JSON.stringify({ p_action_id: actionId, p_status: status, p_cache_hit: cacheHit, p_error_code: "" }),
  });
}

export async function refundUsage(actionId: string, status: "failed" | "cancelled", errorCode: string): Promise<void> {
  await accountFetch("rpc/refund_usage", {
    method: "POST",
    body: JSON.stringify({ p_action_id: actionId, p_status: status, p_error_code: errorCode.slice(0, 120) }),
  });
}

export async function recordUsageExecution(args: {
  actionId: string;
  route: string;
  provider: string;
  model: string;
  promptTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  completionTokens?: number;
  estimatedCostMicrousd?: number;
  status: "succeeded" | "failed" | "cancelled";
  errorCode?: string;
}): Promise<void> {
  await accountFetch("usage_executions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      action_id: args.actionId,
      route: args.route,
      provider: args.provider,
      model: args.model,
      prompt_tokens: Math.max(0, Math.floor(args.promptTokens ?? 0)),
      prompt_cache_hit_tokens: Math.max(0, Math.floor(args.promptCacheHitTokens ?? 0)),
      prompt_cache_miss_tokens: Math.max(0, Math.floor(args.promptCacheMissTokens ?? 0)),
      completion_tokens: Math.max(0, Math.floor(args.completionTokens ?? 0)),
      estimated_cost_microusd: Math.max(0, Math.floor(args.estimatedCostMicrousd ?? 0)),
      status: args.status,
      error_code: (args.errorCode ?? "").slice(0, 120),
    }]),
  });
}

export async function listSyncObjects(userId: string): Promise<AccountSyncObject[]> {
  const rows = await accountFetch<SyncObjectRow[]>(
    `user_data_objects?user_id=eq.${encodeURIComponent(userId)}&select=kind,object_key,payload,client_updated_at,server_version,deleted_at&order=kind.asc,object_key.asc`,
  );
  return rows.map((row) => ({
    kind: row.kind,
    objectKey: row.object_key,
    payload: row.payload,
    clientUpdatedAt: row.client_updated_at,
    serverVersion: Number(row.server_version),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  }));
}

export async function writeSyncObjects(userId: string, objects: AccountSyncObject[]): Promise<AccountSyncWriteResult[]> {
  if (!objects.length) {
    return [];
  }
  const rows = await accountFetch<Array<SyncObjectRow & { accepted: boolean }>>("rpc/merge_user_data_objects", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_objects: objects }),
  });
  return rows.map((row) => ({
    kind: row.kind,
    objectKey: row.object_key,
    payload: row.payload,
    clientUpdatedAt: row.client_updated_at,
    serverVersion: Number(row.server_version),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    accepted: row.accepted,
  }));
}
