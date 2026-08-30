"use client";

import ClearableField from "@/components/ClearableField";

import { useEffect, useMemo, useState } from "react";
import AdminInvitationCodesPanel from "@/components/AdminInvitationCodesPanel";

type ManagedPlanId = "guest" | "free" | "basic" | "plus" | "max";
type UserPlanId = "free" | "basic" | "plus" | "max" | "admin";
type ManagedMetric = "guest_article_lookup" | "guest_dictionary_lookup" | "guest_text_import" | "guest_url_import" | "lookup_generation" | "deep_reading";

interface DashboardData {
  profiles: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  limits: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  executions: Array<Record<string, unknown>>;
  usageSummary: {
    windowDays: number;
    windowStart: string;
    windowEnd: string;
    executions: number;
    failed: number;
    failureRate: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostMicrousd: number;
    estimatedCostMicrocny: number;
    estimatedCostCny: number;
    usdToCnyRate: number;
    daily: Array<{
      date: string;
      executions: number;
      failed: number;
      failureRate: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCostCny: number;
    }>;
    features: Array<{
      key: string;
      label: string;
      executions: number;
      failed: number;
      failureRate: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCostCny: number;
    }>;
    truncated: boolean;
    pricingBasis: string;
  };
}

interface PlanRule {
  id: ManagedPlanId;
  name: string;
  description: string;
  metrics: Array<{
    key: ManagedMetric;
    label: string;
    unit: string;
    windowType: "day" | "month";
  }>;
}

const PLAN_RULES: PlanRule[] = [
  {
    id: "guest",
    name: "游客试用",
    description: "未登录访客",
    metrics: [
      { key: "guest_article_lookup", label: "文章语境查询", unit: "次 / 天", windowType: "day" },
      { key: "guest_dictionary_lookup", label: "单独查词", unit: "次 / 天", windowType: "day" },
      { key: "guest_text_import", label: "粘贴正文", unit: "次 / 天", windowType: "day" },
      { key: "guest_url_import", label: "网址导入", unit: "次 / 天", windowType: "day" },
    ],
  },
  {
    id: "free",
    name: "免费账号",
    description: "注册后的默认套餐",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "deep_reading", label: "深度阅读", unit: "点 / 月", windowType: "month" },
    ],
  },
  {
    id: "basic",
    name: "Basic",
    description: "轻量使用",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "deep_reading", label: "深度阅读", unit: "点 / 月", windowType: "month" },
    ],
  },
  {
    id: "plus",
    name: "Plus",
    description: "高频阅读",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "deep_reading", label: "深度阅读", unit: "点 / 月", windowType: "month" },
    ],
  },
  {
    id: "max",
    name: "Max",
    description: "重度使用",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "deep_reading", label: "深度阅读", unit: "点 / 月", windowType: "month" },
    ],
  },
];

const USER_PLAN_LABELS: Record<UserPlanId, string> = {
  free: "免费账号",
  basic: "Basic",
  plus: "Plus",
  max: "Max",
  admin: "开发者账号",
};

const USAGE_DAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  weekday: "short",
});

function formatUsageDay(dayKey: string): string {
  return USAGE_DAY_FORMATTER.format(new Date(`${dayKey}T00:00:00+08:00`)).replace(/日(?=周)/, "日 · ");
}

function limitKey(planId: string, metricKey: string): string {
  return `${planId}:${metricKey}`;
}

function profileName(profile: Record<string, unknown>): string {
  return String(profile.nickname || profile.phone || profile.email || "未设置昵称");
}

export default function AdminAccountsPanel() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState<{ phone: string; pin: string } | null>(null);

  async function load() {
    const response = await fetch("/api/admin/accounts", { cache: "no-store" });
    const next = (await response.json().catch(() => null)) as DashboardData & { error?: string } | null;
    if (!response.ok || !next) {
      setError(next?.error || "账号与用量读取失败，请重新登录管理员后台。");
      return;
    }
    setData(next);
    setLimitDrafts(Object.fromEntries(next.limits.map((limit) => [
      limitKey(String(limit.plan_id), String(limit.metric_key)),
      String(Number(limit.allowance || 0)),
    ])));
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchAccount(body: Record<string, unknown>, key: string): Promise<Record<string, unknown>> {
    setSaving(key);
    setSavedMessage("");
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        setError(result.error || "保存失败。");
      } else {
        setError("");
        await load();
        setSavedMessage("设置已保存。");
      }
      return result;
    } catch {
      setError("网络连接失败，请稍后重试。");
      return {};
    } finally {
      setSaving("");
    }
  }

  async function savePlanRule(plan: PlanRule) {
    const limits = plan.metrics.map((metric) => ({
      metricKey: metric.key,
      allowance: Number(limitDrafts[limitKey(plan.id, metric.key)]),
      windowType: metric.windowType,
    }));
    if (limits.some((limit) => !Number.isFinite(limit.allowance) || limit.allowance < 0 || !Number.isInteger(limit.allowance))) {
      setError("套餐额度必须填写为不小于 0 的整数。");
      return;
    }
    await patchAccount({ action: "set_plan_limits", planId: plan.id, limits }, `limits-${plan.id}`);
  }

  const entitlementByUser = useMemo(
    () => new Map((data?.entitlements ?? []).map((item) => [String(item.user_id), item])),
    [data],
  );

  const visibleProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    const profiles = data?.profiles ?? [];
    if (!term) return profiles;
    return profiles.filter((profile) => [profile.nickname, profile.phone, profile.email]
      .some((value) => String(value || "").toLowerCase().includes(term)));
  }, [data, search]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[24px] font-semibold leading-tight">用户与额度</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#4d535a]">管理普通用户能用多少次 AI 功能，并处理账号套餐、封禁和密码重置。</p>
        </div>
        <button className="min-h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm font-medium text-[#0066cc] hover:bg-[#f2f7fc]" type="button" onClick={() => void load()}>
          刷新数据
        </button>
      </div>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">{error}</p>}
      {savedMessage && <p className="mt-5 rounded-xl bg-[#e9f5ee] px-4 py-3 text-sm text-[#17613b]" role="status">{savedMessage}</p>}
      {notice && (
        <div className="mt-5 flex flex-col gap-3 rounded-xl bg-[#fff6e6] px-4 py-4 text-sm text-[#674716] sm:flex-row sm:items-center sm:justify-between" role="status">
          <p><strong>{notice.phone}</strong> 的临时密码：<span className="ml-1 font-mono text-base tracking-[.14em]">{notice.pin}</span><br /><span className="text-xs">请立即复制给用户，关闭后不会再次显示。</span></p>
          <div className="flex gap-2"><button className="min-h-9 rounded-full bg-white px-3" type="button" onClick={() => void navigator.clipboard.writeText(notice.pin)}>复制密码</button><button className="min-h-9 rounded-full px-3" type="button" onClick={() => setNotice(null)}>关闭</button></div>
        </div>
      )}
      {!data && !error && <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="正在读取账号与用量">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-white motion-reduce:animate-none" />)}</div>}

      {data && (
        <>
          <section className="mt-6 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-4">
              <h3 className="text-lg font-semibold">每日运行情况</h3>
              <p className="mt-1 text-xs leading-5 text-[#68717a]">过去 {data.usageSummary.windowDays} 个上海自然日的站内已记录调用。成本按 DeepSeek 人民币价、模型、缓存 token 和调用时间逐条重算，周末全天按低谷价；DeepSeek 控制台实扣仍是最终依据。</p>
            </div>
            <div className="divide-y divide-[#e1e5e9]">
              {data.usageSummary.daily.slice(0, 7).map((day, index) => <DailyUsageRow key={day.date} day={day} today={index === 0} />)}
              {data.usageSummary.daily.length > 7 && (
                <details className="group">
                  <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-[#175a8d] hover:bg-[#f6f9fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1769aa]">
                    <span className="group-open:hidden">查看更早的 {data.usageSummary.daily.length - 7} 天</span>
                    <span className="hidden group-open:inline">收起更早记录</span>
                  </summary>
                  <div className="divide-y divide-[#e1e5e9] border-t border-[#e1e5e9]">
                    {data.usageSummary.daily.slice(7).map((day) => <DailyUsageRow key={day.date} day={day} />)}
                  </div>
                </details>
              )}
            </div>
            {data.usageSummary.truncated && <p className="border-t border-[#e1e5e9] px-5 py-3 text-xs text-[#8d3224]">过去 30 天记录超过 50,000 条，当前统计已达到安全读取上限，需要增加数据库聚合后才能显示完整总数。</p>}
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-4">
              <h3 className="text-lg font-semibold">按功能统计</h3>
              <p className="mt-1 text-xs leading-5 text-[#68717a]">同一项用户操作可能包含结构化与流式两次上游调用，因此这里按真实 DeepSeek 执行次数统计。全文翻译单独列出。</p>
            </div>
            <div className="divide-y divide-[#e1e5e9]">
              {data.usageSummary.features.length === 0 && <p className="px-5 py-8 text-center text-sm text-[#68717a]">过去 30 天没有站内 AI 执行记录。</p>}
              {data.usageSummary.features.map((feature) => (
                <article key={feature.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-5">
                  <div>
                    <strong className="text-sm text-[#17191c]">{feature.label}</strong>
                    {feature.key === "translation" && <p className="mt-1 text-[11px] text-[#175a8d]">单独统计</p>}
                  </div>
                  <dl className="grid grid-cols-3 divide-x divide-[#e1e5e9]">
                    <div className="pr-3">
                      <dt className="text-[11px] text-[#68717a]">执行</dt>
                      <dd className="mt-1 text-lg font-semibold text-[#17191c]">{feature.executions.toLocaleString("zh-CN")} 次</dd>
                    </div>
                    <div className="px-3">
                      <dt className="text-[11px] text-[#68717a]">Tokens</dt>
                      <dd className="mt-1 text-lg font-semibold text-[#17191c]">{(feature.promptTokens + feature.completionTokens).toLocaleString("zh-CN")}</dd>
                    </div>
                    <div className="pl-3">
                      <dt className="text-[11px] text-[#68717a]">成本估计</dt>
                      <dd className="mt-1 text-lg font-semibold text-[#17191c]">￥{feature.estimatedCostCny.toFixed(4)}</dd>
                      <dd className="mt-1 text-[11px] leading-4 text-[#68717a]">占已记录成本 {data.usageSummary.estimatedCostCny ? (feature.estimatedCostCny / data.usageSummary.estimatedCostCny * 100).toFixed(1) : "0.0"}%</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <AdminInvitationCodesPanel profiles={data.profiles} />

          <section className="mt-6 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-5">
              <h3 className="text-[21px] font-semibold">套餐额度规则</h3>
              <div className="mt-3 max-w-3xl rounded-xl bg-[#edf5fb] px-4 py-3 text-sm leading-6 text-[#174d73]">
                <p><strong>AI 查词与追问：</strong>注册用户只有新生成解释或句子追问会扣次数，缓存命中免费；游客无论缓存或新生成都计入每日试用。</p>
                <p className="mt-1"><strong>深度阅读：</strong>用于全文翻译和摘要。大约每 1,000 个字符消耗 1 点，摘要至少 2 点。</p>
              </div>
            </div>
            <div className="divide-y divide-[#e1e5e9]">
              {PLAN_RULES.map((plan) => (
                <div key={plan.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-end">
                  <div><strong className="text-base text-[#17191c]">{plan.name}</strong><p className="mt-1 text-xs text-[#68717a]">{plan.description}</p></div>
                  <div className={`grid gap-3 ${plan.metrics.length > 1 ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
                    {plan.metrics.map((metric) => {
                      const key = limitKey(plan.id, metric.key);
                      return (
                        <label key={metric.key} className="text-sm font-medium text-[#343a40]">
                          {metric.label}
                          <span className="mt-2 flex min-h-11 overflow-hidden rounded-xl border border-[#c9ced6] bg-white focus-within:border-[#1769aa] focus-within:ring-2 focus-within:ring-[#1769aa]/15">
                            <input className="min-w-0 flex-1 px-3.5 text-base outline-none" type="number" min="0" step="1" inputMode="numeric" value={limitDrafts[key] ?? ""} onChange={(event) => setLimitDrafts((current) => ({ ...current, [key]: event.target.value }))} aria-label={`${plan.name} ${metric.label}`} />
                            <span className="flex items-center bg-[#f3f5f7] px-3 text-xs text-[#59636c]">{metric.unit}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button className="min-h-10 rounded-full bg-[#1769aa] px-4 text-sm font-medium text-white hover:bg-[#10598f] disabled:bg-[#aeb8c2]" type="button" disabled={saving === `limits-${plan.id}`} onClick={() => void savePlanRule(plan)}>
                    {saving === `limits-${plan.id}` ? "保存中..." : "保存本套餐"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl bg-white">
            <div className="flex flex-col gap-4 border-b border-[#e1e5e9] px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
              <div><h3 className="text-[21px] font-semibold">用户账号</h3><p className="mt-1 text-sm leading-6 text-[#4d535a]">日常通常只需要分配套餐、封禁异常账号或帮助用户重置密码。</p></div>
              <label className="text-sm font-medium text-[#343a40]">搜索用户<ClearableField className="mt-2 sm:w-64" value={search} onClear={() => setSearch("")} label="清空用户搜索"><input className="block min-h-10 w-full rounded-xl border border-[#c9ced6] px-3.5 outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="昵称或手机号" /></ClearableField></label>
            </div>

            {visibleProfiles.length === 0 ? (
              <div className="px-5 py-12 text-center"><h4 className="font-semibold">没有找到用户</h4><p className="mt-2 text-sm text-[#68717a]">换一个昵称或手机号再试。</p></div>
            ) : (
              <ul className="divide-y divide-[#e1e5e9]">
                {visibleProfiles.map((profile) => {
                  const userId = String(profile.user_id);
                  const entitlement = entitlementByUser.get(userId);
                  const bonuses = (entitlement?.bonus_limits ?? {}) as Record<string, number>;
                  const status = String(profile.status || "active");
                  return (
                    <li key={userId} className="px-5 py-5">
                      <article>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><strong>{profileName(profile)}</strong><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "active" ? "bg-[#e9f5ee] text-[#17613b]" : "bg-red-50 text-red-700"}`}>{status === "active" ? "正常" : "已封禁"}</span></div>
                            <p className="mt-1 break-all text-xs text-[#68717a]">{profile.phone ? `手机号 ${String(profile.phone)}` : String(profile.email || userId)}</p>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label className="text-xs font-medium text-[#59636c]">套餐<select className="ml-2 min-h-10 rounded-xl border border-[#c9ced6] bg-white px-3 text-sm text-[#17191c]" value={String(entitlement?.plan_id || "free")} aria-label={`${profileName(profile)} 的套餐`} disabled={saving === `plan-${userId}`} onChange={(event) => void patchAccount({ action: "set_plan", userId, planId: event.target.value }, `plan-${userId}`)}>{(Object.entries(USER_PLAN_LABELS) as Array<[UserPlanId, string]>).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                            <button className={`min-h-10 rounded-full px-4 text-sm font-medium ${status === "active" ? "text-red-700 hover:bg-red-50" : "border border-[#b8c7d5] text-[#175a8d] hover:bg-[#edf5fb]"}`} type="button" disabled={saving === `status-${userId}`} onClick={() => void patchAccount({ action: "set_status", userId, status: status === "active" ? "suspended" : "active" }, `status-${userId}`)}>{saving === `status-${userId}` ? "处理中..." : status === "active" ? "封禁账号" : "解除封禁"}</button>
                          </div>
                        </div>

                        <details className="mt-4 rounded-xl bg-[#f3f5f7] px-4 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-[#4d535a]">更多账号操作</summary>
                          <p className="mt-3 text-xs leading-5 text-[#68717a]">额外额度会在用户每个周期都叠加到套餐额度上，只有特殊邀请或补偿时才需要设置。</p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <BonusControl label="每周期额外查词次数" userId={userId} metric="lookup_generation" value={Number(bonuses.lookup_generation || 0)} saving={saving} onSave={patchAccount} />
                            <BonusControl label="每周期额外深度阅读点数" userId={userId} metric="deep_reading" value={Number(bonuses.deep_reading || 0)} saving={saving} onSave={patchAccount} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button className="min-h-9 rounded-full border border-[#b8c7d5] bg-white px-3 text-sm text-[#175a8d] hover:bg-[#edf5fb]" type="button" disabled={saving === `reset-${userId}`} onClick={() => void patchAccount({ action: "reset_usage", userId }, `reset-${userId}`)}>{saving === `reset-${userId}` ? "清零中..." : "清零当前周期用量"}</button>
                            {profile.login_method === "phone_pin" && <button className="min-h-9 rounded-full border border-[#b8c7d5] bg-white px-3 text-sm text-[#175a8d] hover:bg-[#edf5fb]" type="button" disabled={saving === `pin-${userId}`} onClick={async () => { if (!window.confirm(`确定重置 ${String(profile.phone)} 的密码吗？旧密码会立即失效。`)) return; const result = await patchAccount({ action: "reset_pin", userId }, `pin-${userId}`); if (typeof result.temporaryPin === "string") setNotice({ phone: String(profile.phone), pin: result.temporaryPin }); }}>{saving === `pin-${userId}` ? "重置中..." : "生成临时密码"}</button>}
                          </div>
                        </details>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BonusControl({
  label,
  userId,
  metric,
  value,
  saving,
  onSave,
}: {
  label: string;
  userId: string;
  metric: "lookup_generation" | "deep_reading";
  value: number;
  saving: string;
  onSave: (body: Record<string, unknown>, key: string) => Promise<unknown>;
}) {
  const id = `bonus-${metric}-${userId}`;
  return (
    <label className="text-sm font-medium text-[#343a40]">
      {label}
      <span className="mt-2 flex min-h-10 overflow-hidden rounded-xl border border-[#c9ced6] bg-white focus-within:border-[#1769aa] focus-within:ring-2 focus-within:ring-[#1769aa]/15">
        <input id={id} className="min-w-0 flex-1 px-3 outline-none" type="number" min="0" step="1" defaultValue={value} />
        <button className="border-l border-[#d7dce1] px-3 text-xs font-medium text-[#175a8d] hover:bg-[#edf5fb] disabled:text-[#8c969e]" type="button" disabled={saving === id} onClick={() => { const input = document.getElementById(id) as HTMLInputElement; void onSave({ action: "set_bonus", userId, metricKey: metric, allowance: Number(input.value) }, id); }}>{saving === id ? "保存中" : "保存"}</button>
      </span>
    </label>
  );
}

function DailyUsageRow({
  day,
  today = false,
}: {
  day: DashboardData["usageSummary"]["daily"][number];
  today?: boolean;
}) {
  return (
    <article className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-5">
      <div className="flex items-center gap-2 sm:block">
        <time className="text-sm font-semibold text-[#17191c]" dateTime={day.date}>{formatUsageDay(day.date)}</time>
        {today && <span className="rounded-full bg-[#edf5fb] px-2 py-0.5 text-[11px] font-medium text-[#175a8d] sm:ml-2">今天</span>}
      </div>
      <dl className="grid grid-cols-3 divide-x divide-[#e1e5e9]">
        <div className="pr-3">
          <dt className="text-[11px] text-[#68717a]">用量</dt>
          <dd className="mt-1 text-lg font-semibold text-[#17191c]">{day.executions.toLocaleString("zh-CN")} 次</dd>
          <dd className="mt-1 text-[11px] leading-4 text-[#68717a]">输入 {day.promptTokens.toLocaleString("zh-CN")}<br />输出 {day.completionTokens.toLocaleString("zh-CN")} tokens</dd>
        </div>
        <div className="px-3">
          <dt className="text-[11px] text-[#68717a]">成本估计</dt>
          <dd className="mt-1 text-lg font-semibold text-[#17191c]">￥{day.estimatedCostCny.toFixed(4)}</dd>
        </div>
        <div className="pl-3">
          <dt className="text-[11px] text-[#68717a]">失败执行</dt>
          <dd className="mt-1 text-lg font-semibold text-[#17191c]">{day.failed.toLocaleString("zh-CN")} 次</dd>
          <dd className="mt-1 text-[11px] leading-4 text-[#68717a]">失败率 {(day.failureRate * 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </article>
  );
}
