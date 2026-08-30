import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { phoneFromAccountEmail, resetPhoneAccountPin } from "@/lib/userAuth";
import {
  deepSeekUsdToCnyRate,
  estimateDeepSeekCostMicrocny,
  microcnyToCny,
  shanghaiUsageWindow,
  summarizeUsageExecutionsByFeature,
  summarizeUsageExecutionsByShanghaiDay,
  type UsageExecutionSummaryRow,
} from "@/lib/usageCost";
import type { AccountPlanId, UsageMetricKey } from "@/types/account";

const PLANS = new Set<AccountPlanId>(["guest", "free", "basic", "plus", "max", "admin"]);
const METRICS = new Set<UsageMetricKey>(["guest_lookup", "guest_article_lookup", "guest_dictionary_lookup", "guest_text_import", "guest_url_import", "lookup_generation", "deep_reading", "article_summary", "full_article_translation"]);
const MANAGED_PLAN_METRICS: Partial<Record<AccountPlanId, UsageMetricKey[]>> = {
  guest: ["guest_article_lookup", "guest_dictionary_lookup", "guest_text_import", "guest_url_import"],
  free: ["lookup_generation", "article_summary", "full_article_translation"],
  basic: ["lookup_generation", "article_summary", "full_article_translation"],
  plus: ["lookup_generation", "article_summary", "full_article_translation"],
  max: ["lookup_generation", "article_summary", "full_article_translation"],
};

interface UsageExecutionRow extends Record<string, unknown>, UsageExecutionSummaryRow {}

interface UsageActionRow extends Record<string, unknown> {
  id: string;
  user_id?: string | null;
  guest_id?: string | null;
  feature?: string;
  metric_key?: string;
  quota_units?: number;
  status?: string;
  cache_hit?: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface ActivityRow extends Record<string, unknown> {
  activity_day: string;
  owner_key: string;
  identity_kind: "account" | "guest";
}

const USAGE_WINDOW_DAYS = 30;
const EXECUTION_PAGE_SIZE = 1_000;
const EXECUTION_SAFETY_LIMIT = 50_000;

async function listRecentUsageExecutions(windowStart: string): Promise<{ rows: UsageExecutionRow[]; truncated: boolean }> {
  const rows: UsageExecutionRow[] = [];
  for (let offset = 0; offset < EXECUTION_SAFETY_LIMIT; offset += EXECUTION_PAGE_SIZE) {
    const page = await accountFetch<UsageExecutionRow[]>(
      `usage_executions?select=action_id,route,provider,model,prompt_tokens,prompt_cache_hit_tokens,prompt_cache_miss_tokens,completion_tokens,status,error_code,created_at&created_at=gte.${encodeURIComponent(windowStart)}&order=created_at.desc&limit=${EXECUTION_PAGE_SIZE}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < EXECUTION_PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const windowEnd = new Date();
  const usageWindow = shanghaiUsageWindow(windowEnd, USAGE_WINDOW_DAYS);
  const windowStart = usageWindow.windowStart;
  const [profiles, entitlements, plans, limits, actions, activities, executionPage] = await Promise.all([
    accountFetch<Array<Record<string, unknown>>>("account_profiles?select=user_id,email,nickname,status,english_level,learning_goal,created_at,updated_at&order=created_at.desc&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("user_entitlements?select=user_id,plan_id,source,starts_at,ends_at,bonus_limits&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("quota_plans?select=id,display_name,price_cny,active&order=sort_order.asc"),
    accountFetch<Array<Record<string, unknown>>>("quota_plan_limits?select=plan_id,metric_key,allowance,window_type&order=plan_id.asc,metric_key.asc"),
    accountFetch<UsageActionRow[]>(`usage_actions?select=id,user_id,guest_id,feature,metric_key,quota_units,status,cache_hit,metadata,created_at&created_at=gte.${encodeURIComponent(windowStart)}&order=created_at.desc&limit=5000`),
    accountFetch<ActivityRow[]>(`account_activity_days?select=activity_day,owner_key,identity_kind&activity_day=gte.${usageWindow.dayKeys[usageWindow.dayKeys.length - 1]}&order=activity_day.desc&limit=50000`),
    listRecentUsageExecutions(windowStart),
  ]);
  const executions = executionPage.rows;
  const usdToCnyRate = deepSeekUsdToCnyRate();
  const daily = summarizeUsageExecutionsByShanghaiDay(executions, usageWindow.dayKeys);
  const features = summarizeUsageExecutionsByFeature(executions);
  const executionsByAction = new Map<string, UsageExecutionRow[]>();
  for (const execution of executions) {
    const actionId = String(execution.action_id || "");
    if (!actionId) continue;
    const actionExecutions = executionsByAction.get(actionId) ?? [];
    actionExecutions.push(execution);
    executionsByAction.set(actionId, actionExecutions);
  }
  const summarizeActions = (metricKey: "article_summary" | "full_article_translation") => {
    const metricActions = actions.filter((action) => action.metric_key === metricKey);
    const providerExecutions = metricActions.flatMap((action) => executionsByAction.get(action.id) ?? []);
    const promptTokens = providerExecutions.reduce((sum, execution) => sum + Number(execution.prompt_tokens || 0), 0);
    const completionTokens = providerExecutions.reduce((sum, execution) => sum + Number(execution.completion_tokens || 0), 0);
    const estimatedCostMicrocny = providerExecutions.reduce((sum, execution) => sum + estimateDeepSeekCostMicrocny(
      String(execution.model || "deepseek-v4-pro"),
      execution,
      new Date(String(execution.created_at || "")),
    ), 0);
    return {
      chargedActions: metricActions.filter((action) => Number(action.quota_units || 0) > 0 && (action.status === "succeeded" || action.status === "cached")).length,
      succeededActions: metricActions.filter((action) => action.status === "succeeded" || action.status === "cached").length,
      failedActions: metricActions.filter((action) => action.status === "failed" || action.status === "cancelled").length,
      generatedArticles: new Set(metricActions.filter((action) => action.status === "succeeded").map((action) => String(action.metadata?.articleKey || action.id))).size,
      providerExecutions: providerExecutions.length,
      promptTokens,
      completionTokens,
      estimatedCostCny: microcnyToCny(estimatedCostMicrocny),
    };
  };
  const summaryUsage = summarizeActions("article_summary");
  const translationUsage = summarizeActions("full_article_translation");
  const publicCacheActions = actions.filter((action) => action.metric_key === "full_article_translation" && action.metadata?.source === "public_cache" && action.status === "cached");
  const publicCacheUsage = {
    hits: publicCacheActions.length,
    articles: new Set(publicCacheActions.map((action) => String(action.metadata?.publicArticleId || action.metadata?.articleKey || "")).filter(Boolean)).size,
    avoidedDeepSeekCalls: publicCacheActions.reduce((sum, action) => sum + Math.max(0, Number(action.metadata?.avoidedDeepSeekCalls || 0)), 0),
    actualModelCostCny: 0,
  };
  const actionDetails = actions
    .filter((action) => action.metric_key === "article_summary" || action.metric_key === "full_article_translation")
    .slice(0, 500)
    .map((action) => {
      const providerExecutions = executionsByAction.get(action.id) ?? [];
      const estimatedCostMicrocny = providerExecutions.reduce((sum, execution) => sum + estimateDeepSeekCostMicrocny(
        String(execution.model || "deepseek-v4-pro"), execution, new Date(String(execution.created_at || "")),
      ), 0);
      return {
        id: action.id,
        userId: action.user_id || "",
        metricKey: action.metric_key,
        quotaUnits: Number(action.quota_units || 0),
        status: action.status || "",
        cacheHit: Boolean(action.cache_hit),
        source: String(action.metadata?.source || "generated"),
        articleKey: String(action.metadata?.articleKey || ""),
        articleLabel: String(action.metadata?.articleLabel || "用户文章"),
        providerExecutions: providerExecutions.length,
        promptTokens: providerExecutions.reduce((sum, execution) => sum + Number(execution.prompt_tokens || 0), 0),
        completionTokens: providerExecutions.reduce((sum, execution) => sum + Number(execution.completion_tokens || 0), 0),
        estimatedCostCny: microcnyToCny(estimatedCostMicrocny),
        createdAt: action.created_at || "",
      };
    });
  const activityCounts = (days: number, identityKind?: "account" | "guest") => {
    const selectedDays = new Set(usageWindow.dayKeys.slice(0, days));
    return new Set(activities.filter((row) => selectedDays.has(row.activity_day) && (!identityKind || row.identity_kind === identityKind)).map((row) => row.owner_key)).size;
  };
  const activitySummary = {
    dau: activityCounts(1),
    wau: activityCounts(7),
    mau: activityCounts(30),
    accountDau: activityCounts(1, "account"),
    accountWau: activityCounts(7, "account"),
    accountMau: activityCounts(30, "account"),
    guestDau: activityCounts(1, "guest"),
    guestWau: activityCounts(7, "guest"),
    guestMau: activityCounts(30, "guest"),
    daily: usageWindow.dayKeys.map((date) => ({
      date,
      accounts: new Set(activities.filter((row) => row.activity_day === date && row.identity_kind === "account").map((row) => row.owner_key)).size,
      guests: new Set(activities.filter((row) => row.activity_day === date && row.identity_kind === "guest").map((row) => row.owner_key)).size,
    })),
  };
  const failed = daily.reduce((sum, day) => sum + day.failed, 0);
  const estimatedCostMicrousd = daily.reduce((sum, day) => sum + day.estimatedCostMicrousd, 0);
  const estimatedCostMicrocny = daily.reduce((sum, day) => sum + day.estimatedCostMicrocny, 0);
  const usageSummary = {
    windowDays: USAGE_WINDOW_DAYS,
    windowStart,
    windowEnd: windowEnd.toISOString(),
    executions: executions.length,
    failed,
    failureRate: executions.length ? failed / executions.length : 0,
    promptTokens: executions.reduce((sum, execution) => sum + Number(execution.prompt_tokens || 0), 0),
    completionTokens: executions.reduce((sum, execution) => sum + Number(execution.completion_tokens || 0), 0),
    estimatedCostMicrousd,
    estimatedCostMicrocny,
    estimatedCostCny: microcnyToCny(estimatedCostMicrocny),
    usdToCnyRate,
    daily,
    features,
    truncated: executionPage.truncated,
    pricingBasis: "DeepSeek direct CNY rates, calculated per execution timestamp and cache usage; weekends are off-peak from 2026-08-23",
  };
  const safeProfiles = profiles.map((profile) => {
    const email = String(profile.email ?? "");
    const phone = phoneFromAccountEmail(email);
    return {
      ...profile,
      email: phone ? "" : email,
      phone,
      login_method: phone ? "phone_pin" : "email",
      phone_verified: false,
    };
  });
  return NextResponse.json({
    profiles: safeProfiles,
    entitlements,
    plans,
    limits,
    actions,
    executions: executions.slice(0, 200),
    activitySummary,
    quotaUsage: { summary: summaryUsage, translation: translationUsage, publicCache: publicCacheUsage, details: actionDetails },
    usageSummary,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 64 * 1024).catch(() => null);
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "操作格式无效。" }, { status: 400 });

  let result: Record<string, unknown> = { ok: true };
  if (body.action === "set_plan" && typeof body.userId === "string" && typeof body.planId === "string" && PLANS.has(body.planId as AccountPlanId)) {
    await accountFetch(`user_entitlements?user_id=eq.${encodeURIComponent(body.userId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ plan_id: body.planId, source: "admin", starts_at: new Date().toISOString(), ends_at: null }) });
  } else if (body.action === "set_status" && typeof body.userId === "string" && (body.status === "active" || body.status === "suspended")) {
    await accountFetch(`account_profiles?user_id=eq.${encodeURIComponent(body.userId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: body.status, updated_at: new Date().toISOString() }) });
  } else if (body.action === "set_limit" && typeof body.planId === "string" && typeof body.metricKey === "string" && PLANS.has(body.planId as AccountPlanId) && METRICS.has(body.metricKey as UsageMetricKey) && Number.isFinite(body.allowance)) {
    await accountFetch("quota_plan_limits?on_conflict=plan_id,metric_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ plan_id: body.planId, metric_key: body.metricKey, allowance: Math.max(0, Math.floor(Number(body.allowance))), window_type: body.windowType === "month" ? "month" : "day", updated_at: new Date().toISOString() }]) });
  } else if (body.action === "set_plan_limits" && typeof body.planId === "string" && Array.isArray(body.limits)) {
    const planId = body.planId as AccountPlanId;
    const allowedMetrics = MANAGED_PLAN_METRICS[planId];
    const limits = body.limits.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {});
    const metricKeys = limits.map((limit) => String(limit.metricKey || ""));
    if (!allowedMetrics || limits.length !== allowedMetrics.length || new Set(metricKeys).size !== allowedMetrics.length || !limits.every((limit) =>
      typeof limit.metricKey === "string"
      && allowedMetrics.includes(limit.metricKey as UsageMetricKey)
      && Number.isFinite(limit.allowance)
      && Number(limit.allowance) >= 0
      && Number.isInteger(Number(limit.allowance))
    )) {
      return NextResponse.json({ error: "套餐额度设置无效。" }, { status: 400 });
    }
    await accountFetch("quota_plan_limits?on_conflict=plan_id,metric_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(limits.map((limit) => ({
        plan_id: planId,
        metric_key: limit.metricKey,
        allowance: Number(limit.allowance),
        window_type: limit.metricKey === "article_summary" || limit.metricKey === "full_article_translation" ? "month" : "day",
        updated_at: new Date().toISOString(),
      }))),
    });
  } else if (body.action === "reset_usage" && typeof body.userId === "string") {
    await accountFetch(`usage_counters?owner_key=eq.${encodeURIComponent(`user:${body.userId}`)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  } else if (body.action === "set_bonus" && typeof body.userId === "string" && typeof body.metricKey === "string" && METRICS.has(body.metricKey as UsageMetricKey) && Number.isFinite(body.allowance)) {
    const rows = await accountFetch<Array<{ bonus_limits: Record<string, number> }>>(`user_entitlements?user_id=eq.${encodeURIComponent(body.userId)}&select=bonus_limits&limit=1`);
    const bonusLimits = { ...(rows[0]?.bonus_limits ?? {}), [body.metricKey]: Math.max(0, Math.floor(Number(body.allowance))) };
    await accountFetch(`user_entitlements?user_id=eq.${encodeURIComponent(body.userId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ bonus_limits: bonusLimits }) });
  } else if (body.action === "set_plan_config" && typeof body.planId === "string" && PLANS.has(body.planId as AccountPlanId) && Number.isFinite(body.priceCny)) {
    await accountFetch(`quota_plans?id=eq.${encodeURIComponent(body.planId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ price_cny: Math.max(0, Math.floor(Number(body.priceCny))), active: body.active !== false }) });
  } else if (body.action === "reset_pin" && typeof body.userId === "string") {
    try {
      const temporaryPin = await resetPhoneAccountPin(body.userId);
      result = { ok: true, temporaryPin };
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "密码重置失败。" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  } else {
    return NextResponse.json({ error: "不支持的管理操作。" }, { status: 400 });
  }

  const auditValue = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "pin" && key !== "temporaryPin"));
  await accountFetch("admin_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ admin_label: "password-admin", action: body.action, target_type: typeof body.userId === "string" ? "user" : "quota", target_id: String(body.userId || body.planId || `${body.planId}:${body.metricKey}`), after_value: auditValue }]) });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
