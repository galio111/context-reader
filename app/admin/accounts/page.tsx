"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface DashboardData {
  profiles: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  limits: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  executions: Array<Record<string, unknown>>;
}

export default function AdminAccountsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  async function load() {
    const response = await fetch("/api/admin/accounts");
    const next = await response.json() as DashboardData & { error?: string };
    if (!response.ok) {
      setError(next.error || "读取失败，请先到管理入口登录。");
      return;
    }
    setData(next);
    setError("");
  }

  useEffect(() => { void load(); }, []);

  async function patch(body: Record<string, unknown>, key: string) {
    setSaving(key);
    const response = await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error || "保存失败");
    else await load();
    setSaving("");
  }

  const entitlementByUser = useMemo(
    () => new Map((data?.entitlements ?? []).map((item) => [String(item.user_id), item])),
    [data],
  );
  const totals = useMemo(() => ({
    tokens: (data?.executions ?? []).reduce((sum, item) => sum + Number(item.prompt_tokens || 0) + Number(item.completion_tokens || 0), 0),
    cost: (data?.executions ?? []).reduce((sum, item) => sum + Number(item.estimated_cost_microusd || 0), 0),
    failed: (data?.executions ?? []).filter((item) => item.status === "failed").length,
  }), [data]);

  return (
    <main className="min-h-screen bg-[#f5f5f3] px-4 py-8 text-[#1d2520]">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#68746c]">Operations</p><h1 className="mt-2 text-3xl font-semibold">账号与用量后台</h1></div>
          <div className="flex gap-2"><Link className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm" href="/admin">推荐文章</Link><button className="rounded-full bg-[#1d2520] px-4 py-2 text-sm text-white" onClick={() => void load()}>刷新</button></div>
        </header>
        {error && <p className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {data && <>
          <section className="mt-8 grid gap-4 sm:grid-cols-3"><Stat label="记录 Tokens" value={totals.tokens.toLocaleString()} /><Stat label="估算成本" value={`$${(totals.cost / 1_000_000).toFixed(4)}`} /><Stat label="失败执行" value={String(totals.failed)} /></section>

          <section className="mt-8 rounded-3xl bg-white p-6">
            <h2 className="text-xl font-semibold">套餐价格与状态</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.plans.map((plan) => {
              const key = `plan-config-${plan.id}`;
              return <article key={String(plan.id)} className="rounded-2xl border border-black/10 p-4"><strong>{String(plan.display_name)}</strong><label className="mt-4 block text-xs text-[#6b776f]">月价（人民币）<input id={`price-${plan.id}`} className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2 text-base text-black" type="number" min="0" defaultValue={Number(plan.price_cny)} /></label><label className="mt-3 flex items-center gap-2 text-sm"><input id={`active-${plan.id}`} type="checkbox" defaultChecked={Boolean(plan.active)} />启用套餐</label><button className="mt-4 rounded-xl border border-black/15 px-3 py-2 text-sm" disabled={saving === key} onClick={() => { const price = document.getElementById(`price-${plan.id}`) as HTMLInputElement; const active = document.getElementById(`active-${plan.id}`) as HTMLInputElement; void patch({ action: "set_plan_config", planId: plan.id, priceCny: Number(price.value), active: active.checked }, key); }}>保存</button></article>;
            })}</div>
          </section>

          <section className="mt-8 rounded-3xl bg-white p-6">
            <h2 className="text-xl font-semibold">全局套餐额度</h2>
            <div className="mt-5 grid gap-3">{data.limits.map((limit) => {
              const key = `${limit.plan_id}:${limit.metric_key}`;
              return <div key={key} className="grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-[1fr_1fr_130px_100px]"><span>{String(limit.plan_id)} · {String(limit.metric_key)}</span><span className="text-sm text-[#68746c]">{String(limit.window_type)}</span><input className="rounded-xl border border-black/15 px-3 py-2" type="number" min="0" defaultValue={Number(limit.allowance)} id={`limit-${key}`} /><button className="rounded-xl border border-black/15 px-3 py-2 text-sm" disabled={saving === key} onClick={() => { const element = document.getElementById(`limit-${key}`) as HTMLInputElement; void patch({ action: "set_limit", planId: limit.plan_id, metricKey: limit.metric_key, allowance: Number(element.value), windowType: limit.window_type }, key); }}>保存</button></div>;
            })}</div>
          </section>

          <section className="mt-8 rounded-3xl bg-white p-6">
            <h2 className="text-xl font-semibold">用户</h2>
            <div className="mt-5 grid gap-3">{data.profiles.map((profile) => {
              const userId = String(profile.user_id);
              const entitlement = entitlementByUser.get(userId);
              const bonuses = (entitlement?.bonus_limits ?? {}) as Record<string, number>;
              return <article key={userId} className="rounded-2xl border border-black/10 p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><strong>{String(profile.nickname || profile.email || "未设置昵称")}</strong><p className="mt-1 break-all text-xs text-[#758078]">{String(profile.email || userId)}</p></div><span className="rounded-full bg-[#eef2ee] px-3 py-1 text-xs">{String(profile.status)}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><select className="rounded-xl border border-black/15 px-3 py-2" value={String(entitlement?.plan_id || "free")} onChange={(event) => void patch({ action: "set_plan", userId, planId: event.target.value }, `plan-${userId}`)}>{["free", "basic", "plus", "max", "admin"].map((plan) => <option key={plan}>{plan}</option>)}</select><button className="rounded-xl border border-black/15 px-3 py-2 text-sm" onClick={() => void patch({ action: "set_status", userId, status: profile.status === "active" ? "suspended" : "active" }, `status-${userId}`)}>{profile.status === "active" ? "封禁" : "解封"}</button><BonusControl userId={userId} metric="lookup_generation" value={Number(bonuses.lookup_generation || 0)} onSave={patch} /><BonusControl userId={userId} metric="deep_reading" value={Number(bonuses.deep_reading || 0)} onSave={patch} /></div><button className="mt-3 rounded-xl border border-black/15 px-3 py-2 text-sm" onClick={() => void patch({ action: "reset_usage", userId }, `reset-${userId}`)}>清零本周期用量</button></article>;
            })}</div>
          </section>
        </>}
      </div>
    </main>
  );
}

function BonusControl({ userId, metric, value, onSave }: { userId: string; metric: string; value: number; onSave: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  const id = `bonus-${metric}-${userId}`;
  return <div className="flex rounded-xl border border-black/15"><input id={id} className="min-w-0 flex-1 rounded-l-xl px-3 py-2 text-sm" type="number" min="0" defaultValue={value} aria-label={`${metric} 加量`} /><button className="border-l border-black/15 px-3 text-xs" onClick={() => { const input = document.getElementById(id) as HTMLInputElement; void onSave({ action: "set_bonus", userId, metricKey: metric, allowance: Number(input.value) }, id); }}>加量</button></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="rounded-3xl bg-white p-6"><p className="text-sm text-[#6b776f]">{label}</p><strong className="mt-3 block text-3xl">{value}</strong></article>;
}
