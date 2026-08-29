import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { phoneFromAccountEmail, resetPhoneAccountPin } from "@/lib/userAuth";
import { deepSeekUsdToCnyRate, estimateDeepSeekCostMicrousd, microusdToCny } from "@/lib/usageCost";
import type { AccountPlanId, UsageMetricKey } from "@/types/account";

const PLANS = new Set<AccountPlanId>(["guest", "free", "basic", "plus", "max", "admin"]);
const METRICS = new Set<UsageMetricKey>(["guest_lookup", "guest_article_lookup", "guest_dictionary_lookup", "guest_text_import", "guest_url_import", "lookup_generation", "deep_reading"]);
const MANAGED_PLAN_METRICS: Partial<Record<AccountPlanId, UsageMetricKey[]>> = {
  guest: ["guest_article_lookup", "guest_dictionary_lookup", "guest_text_import", "guest_url_import"],
  free: ["lookup_generation", "deep_reading"],
  basic: ["lookup_generation", "deep_reading"],
  plus: ["lookup_generation", "deep_reading"],
  max: ["lookup_generation", "deep_reading"],
};

interface UsageExecutionRow extends Record<string, unknown> {
  model?: string;
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
  status?: string;
  created_at?: string;
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
  const windowStart = new Date(windowEnd.getTime() - USAGE_WINDOW_DAYS * 86_400_000).toISOString();
  const [profiles, entitlements, plans, limits, actions, executionPage] = await Promise.all([
    accountFetch<Array<Record<string, unknown>>>("account_profiles?select=user_id,email,nickname,status,english_level,learning_goal,created_at,updated_at&order=created_at.desc&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("user_entitlements?select=user_id,plan_id,source,starts_at,ends_at,bonus_limits&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("quota_plans?select=id,display_name,price_cny,active&order=sort_order.asc"),
    accountFetch<Array<Record<string, unknown>>>("quota_plan_limits?select=plan_id,metric_key,allowance,window_type&order=plan_id.asc,metric_key.asc"),
    accountFetch<Array<Record<string, unknown>>>("usage_actions?select=id,user_id,guest_id,feature,metric_key,quota_units,status,created_at&order=created_at.desc&limit=5000"),
    listRecentUsageExecutions(windowStart),
  ]);
  const executions = executionPage.rows;
  const failed = executions.filter((execution) => execution.status === "failed").length;
  const estimatedCostMicrousd = executions.reduce((sum, execution) => sum + estimateDeepSeekCostMicrousd(
    String(execution.model || "deepseek-v4-pro"),
    {
      prompt_tokens: Number(execution.prompt_tokens || 0),
      prompt_cache_hit_tokens: Number(execution.prompt_cache_hit_tokens || 0),
      prompt_cache_miss_tokens: Number(execution.prompt_cache_miss_tokens || 0),
      completion_tokens: Number(execution.completion_tokens || 0),
    },
    new Date(String(execution.created_at || windowEnd.toISOString())),
  ), 0);
  const usdToCnyRate = deepSeekUsdToCnyRate();
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
    estimatedCostCny: microusdToCny(estimatedCostMicrousd, usdToCnyRate),
    usdToCnyRate,
    truncated: executionPage.truncated,
    pricingBasis: "DeepSeek 2026-08-16 peak/off-peak USD rates, calculated per execution timestamp and cache usage, then converted to CNY",
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
  return NextResponse.json({ profiles: safeProfiles, entitlements, plans, limits, actions, executions: executions.slice(0, 200), usageSummary }, { headers: { "Cache-Control": "no-store" } });
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
        window_type: limit.metricKey === "deep_reading" ? "month" : "day",
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
