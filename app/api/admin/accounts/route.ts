import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { phoneFromAccountEmail, resetPhoneAccountPin } from "@/lib/userAuth";
import type { AccountPlanId, UsageMetricKey } from "@/types/account";

const PLANS = new Set<AccountPlanId>(["guest", "free", "basic", "plus", "max", "admin"]);
const METRICS = new Set<UsageMetricKey>(["guest_lookup", "lookup_generation", "deep_reading"]);

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const [profiles, entitlements, plans, limits, actions, executions] = await Promise.all([
    accountFetch<Array<Record<string, unknown>>>("account_profiles?select=user_id,email,nickname,status,english_level,learning_goal,created_at,updated_at&order=created_at.desc&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("user_entitlements?select=user_id,plan_id,source,starts_at,ends_at,bonus_limits&limit=1000"),
    accountFetch<Array<Record<string, unknown>>>("quota_plans?select=id,display_name,price_cny,active&order=sort_order.asc"),
    accountFetch<Array<Record<string, unknown>>>("quota_plan_limits?select=plan_id,metric_key,allowance,window_type&order=plan_id.asc,metric_key.asc"),
    accountFetch<Array<Record<string, unknown>>>("usage_actions?select=id,user_id,guest_id,feature,metric_key,quota_units,status,created_at&order=created_at.desc&limit=5000"),
    accountFetch<Array<Record<string, unknown>>>("usage_executions?select=action_id,route,provider,model,prompt_tokens,prompt_cache_hit_tokens,prompt_cache_miss_tokens,completion_tokens,estimated_cost_microusd,status,error_code,created_at&order=created_at.desc&limit=5000"),
  ]);
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
  return NextResponse.json({ profiles: safeProfiles, entitlements, plans, limits, actions, executions }, { headers: { "Cache-Control": "no-store" } });
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
        { error: error instanceof Error ? error.message : "PIN 重置失败。" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  } else {
    return NextResponse.json({ error: "不支持的管理操作。" }, { status: 400 });
  }

  const auditValue = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "pin" && key !== "temporaryPin"));
  await accountFetch("admin_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ admin_label: "password-admin", action: body.action, target_type: typeof body.userId === "string" ? "user" : "quota", target_id: String(body.userId || `${body.planId}:${body.metricKey}`), after_value: auditValue }]) });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
