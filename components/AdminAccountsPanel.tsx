"use client";

import ClearableField from "@/components/ClearableField";

import { useEffect, useMemo, useState } from "react";
import AdminInvitationCodesPanel from "@/components/AdminInvitationCodesPanel";

type ManagedPlanId = "guest" | "free" | "basic" | "plus" | "max";
type UserPlanId = "free" | "basic" | "plus" | "max" | "admin";
type ManagedMetric = "guest_article_lookup" | "guest_dictionary_lookup" | "guest_text_import" | "guest_url_import" | "lookup_generation" | "article_summary" | "full_article_translation";

interface DashboardData {
  profiles: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  limits: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  executions: Array<Record<string, unknown>>;
  activitySummary: {
    dau: number;
    wau: number;
    mau: number;
    accountDau: number;
    accountWau: number;
    accountMau: number;
    guestDau: number;
    guestWau: number;
    guestMau: number;
    daily: Array<{ date: string; accounts: number; guests: number }>;
  };
  quotaUsage: {
    summary: QuotaFeatureUsage;
    translation: QuotaFeatureUsage;
    publicCache: { hits: number; articles: number; avoidedDeepSeekCalls: number; actualModelCostCny: number };
    details: Array<{
      id: string;
      userId: string;
      metricKey: "article_summary" | "full_article_translation";
      quotaUnits: number;
      status: string;
      cacheHit: boolean;
      source: string;
      articleKey: string;
      articleLabel: string;
      providerExecutions: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCostCny: number;
      createdAt: string;
    }>;
  };
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

interface QuotaFeatureUsage {
  chargedActions: number;
  succeededActions: number;
  failedActions: number;
  generatedArticles: number;
  providerExecutions: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostCny: number;
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
      { key: "article_summary", label: "文章摘要", unit: "次 / 月", windowType: "month" },
      { key: "full_article_translation", label: "全文翻译", unit: "次 / 月", windowType: "month" },
    ],
  },
  {
    id: "basic",
    name: "Basic",
    description: "轻量使用",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "article_summary", label: "文章摘要", unit: "次 / 月", windowType: "month" },
      { key: "full_article_translation", label: "全文翻译", unit: "次 / 月", windowType: "month" },
    ],
  },
  {
    id: "plus",
    name: "Plus",
    description: "高频阅读",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "article_summary", label: "文章摘要", unit: "次 / 月", windowType: "month" },
      { key: "full_article_translation", label: "全文翻译", unit: "次 / 月", windowType: "month" },
    ],
  },
  {
    id: "max",
    name: "Max",
    description: "重度使用",
    metrics: [
      { key: "lookup_generation", label: "AI 查词与追问", unit: "次 / 天", windowType: "day" },
      { key: "article_summary", label: "文章摘要", unit: "次 / 月", windowType: "month" },
      { key: "full_article_translation", label: "全文翻译", unit: "次 / 月", windowType: "month" },
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
  const profileByUser = useMemo(
    () => new Map((data?.profiles ?? []).map((profile) => [String(profile.user_id), profile])),
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

      <nav className="sticky top-2 z-20 mt-5 overflow-x-auto rounded-xl border border-[#dce2e7] bg-white/95 px-2 py-2 shadow-sm backdrop-blur" aria-label="用户与额度目录">
        <div className="flex min-w-max gap-1">
          {[
            ["account-activity", "活跃用户"],
            ["account-cost", "用量成本"],
            ["account-features", "功能拆分"],
            ["account-invitations", "邀请码"],
            ["account-plans", "套餐额度"],
            ["account-users", "用户账号"],
            ["account-details", "扣量明细"],
          ].map(([id, label]) => <a key={id} className="rounded-lg px-3 py-2 text-sm font-medium text-[#47535d] hover:bg-[#edf4f8] hover:text-[#175a8d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1769aa]" href={`#${id}`}>{label}</a>)}
        </div>
      </nav>

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
          <section id="account-activity" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-4">
              <h3 className="text-lg font-semibold">活跃用户</h3>
              <p className="mt-1 text-xs leading-5 text-[#68717a]">按上海自然日统计真正打开过站内客户端的去重身份。MAU 为最近 30 个自然日，不是只做过 AI 操作的人。</p>
            </div>
            <dl className="grid divide-y divide-[#e1e5e9] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <ActivityMetric label="DAU" value={data.activitySummary.dau} accounts={data.activitySummary.accountDau} guests={data.activitySummary.guestDau} note="今天" />
              <ActivityMetric label="WAU" value={data.activitySummary.wau} accounts={data.activitySummary.accountWau} guests={data.activitySummary.guestWau} note="最近 7 天去重" />
              <ActivityMetric label="MAU" value={data.activitySummary.mau} accounts={data.activitySummary.accountMau} guests={data.activitySummary.guestMau} note="最近 30 天去重" />
            </dl>
            <div className="border-t border-[#e1e5e9] px-5 py-4">
              <p className="text-xs font-semibold text-[#59636c]">最近 7 天日活</p>
              <div className="mt-3 grid grid-cols-7 gap-2" aria-label="最近七天日活趋势">
                {data.activitySummary.daily.slice(0, 7).reverse().map((day) => <div key={day.date} className="min-w-0 text-center"><div className="flex h-20 items-end justify-center gap-1 border-b border-[#d7dde2] pb-1"><span className="w-2 rounded-t bg-[#1769aa]" style={{ height: `${Math.max(4, Math.min(72, day.accounts * 8))}px` }} title={`账号 ${day.accounts}`} /><span className="w-2 rounded-t bg-[#9fb8c9]" style={{ height: `${Math.max(4, Math.min(72, day.guests * 8))}px` }} title={`游客 ${day.guests}`} /></div><span className="mt-1 block truncate text-[10px] text-[#7b858d]">{day.date.slice(5)}</span></div>)}
              </div>
            </div>
          </section>

          <section id="account-cost" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
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

          <section id="account-features" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
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

          <section className="mt-6 overflow-hidden rounded-2xl bg-white" aria-labelledby="quota-split-title">
            <div className="border-b border-[#e1e5e9] px-5 py-4">
              <h3 id="quota-split-title" className="text-lg font-semibold">扣量与模型成本拆分</h3>
              <p className="mt-1 text-xs leading-5 text-[#68717a]">用户额度按一次完整动作统计；DeepSeek 请求按实际上游流批次统计。普通文章通常只需 1 次，超长文章才会拆成少量批次。</p>
            </div>
            <div className="divide-y divide-[#e1e5e9]">
              <QuotaUsageRow label="摘要" usage={data.quotaUsage.summary} articleUnit="生成文章" />
              <QuotaUsageRow label="全文翻译" usage={data.quotaUsage.translation} articleUnit="生成文章" />
              <article className="grid gap-3 px-5 py-4 lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-5">
                <div><strong className="text-sm">精选缓存</strong><p className="mt-1 text-[11px] text-[#247044]">实际模型成本 ￥0</p></div>
                <dl className="grid grid-cols-2 gap-y-4 divide-x divide-[#e1e5e9] sm:grid-cols-4">
                  <MetricCell label="命中次数" value={`${data.quotaUsage.publicCache.hits.toLocaleString("zh-CN")} 次`} />
                  <MetricCell label="涉及文章" value={`${data.quotaUsage.publicCache.articles.toLocaleString("zh-CN")} 篇`} />
                  <MetricCell label="节省调用" value={`${data.quotaUsage.publicCache.avoidedDeepSeekCalls.toLocaleString("zh-CN")} 次`} />
                  <MetricCell label="DeepSeek 成本" value="￥0.0000" />
                </dl>
              </article>
            </div>
          </section>

          <div id="account-invitations" className="scroll-mt-24">
            <AdminInvitationCodesPanel profiles={data.profiles} />
          </div>

          <section id="account-plans" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-5">
              <h3 className="text-[21px] font-semibold">套餐额度规则</h3>
              <div className="mt-3 max-w-3xl rounded-xl bg-[#edf5fb] px-4 py-3 text-sm leading-6 text-[#174d73]">
                <p><strong>AI 查词与追问：</strong>注册用户只有新生成解释或句子追问会扣次数，缓存命中免费；游客无论缓存或新生成都计入每日试用。</p>
                <p className="mt-1"><strong>文章摘要：</strong>首次保存且没有有效摘要时生成并扣 1 次；保存后的摘要直接复用。</p>
                <p className="mt-1"><strong>全文翻译：</strong>点击开始一次新翻译扣 1 次，重看已有结果免费；重新生成再扣 1 次。精选缓存首次点击同样扣 1 次，但不调用 DeepSeek。</p>
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

          <section id="account-users" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
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
                            <BonusControl label="每月额外摘要次数" userId={userId} metric="article_summary" value={Number(bonuses.article_summary || 0)} saving={saving} onSave={patchAccount} />
                            <BonusControl label="每月额外全文翻译次数" userId={userId} metric="full_article_translation" value={Number(bonuses.full_article_translation || 0)} saving={saving} onSave={patchAccount} />
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

          <section id="account-details" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-5">
              <h3 className="text-[21px] font-semibold">每个用户、每篇文章的扣量记录</h3>
              <p className="mt-1 text-sm leading-6 text-[#4d535a]">最近 30 天最多显示 500 条摘要和全文翻译动作。私人文章只显示匿名正文版本，不保存正文内容。</p>
            </div>
            {data.quotaUsage.details.length === 0 ? <p className="px-5 py-10 text-center text-sm text-[#68717a]">还没有摘要或全文翻译扣量记录。</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="bg-[#f5f7f8] text-xs text-[#59636c]"><tr><th className="px-5 py-3 font-semibold">时间 / 用户</th><th className="px-3 py-3 font-semibold">文章</th><th className="px-3 py-3 font-semibold">类型</th><th className="px-3 py-3 font-semibold">用户扣量</th><th className="px-3 py-3 font-semibold">DeepSeek</th><th className="px-3 py-3 font-semibold">Tokens / 成本</th><th className="px-5 py-3 font-semibold">结果</th></tr></thead>
                  <tbody className="divide-y divide-[#e1e5e9]">{data.quotaUsage.details.map((detail) => {
                    const profile = profileByUser.get(detail.userId);
                    const totalTokens = detail.promptTokens + detail.completionTokens;
                    return <tr key={detail.id} className="align-top"><td className="px-5 py-4"><time className="block whitespace-nowrap">{new Date(detail.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><span className="mt-1 block text-xs text-[#68717a]">{profile ? profileName(profile) : "账号已删除"}</span></td><td className="max-w-xs px-3 py-4"><strong className="block truncate text-[#27333d]" title={detail.articleLabel}>{detail.articleLabel}</strong><span className="mt-1 block font-mono text-[11px] text-[#7b858d]">{detail.articleKey.slice(0, 12) || "无版本号"}</span></td><td className="px-3 py-4">{detail.metricKey === "article_summary" ? "摘要" : detail.source === "public_cache" ? "精选缓存" : "全文翻译"}</td><td className="px-3 py-4">{detail.quotaUnits > 0 ? `${detail.quotaUnits} 次` : "0 次"}</td><td className="px-3 py-4">{detail.providerExecutions} 次调用</td><td className="px-3 py-4">{totalTokens.toLocaleString("zh-CN")}<span className="mt-1 block text-xs text-[#68717a]">￥{detail.estimatedCostCny.toFixed(4)}</span></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${detail.status === "succeeded" || detail.status === "cached" ? "bg-[#e9f5ee] text-[#17613b]" : "bg-red-50 text-red-700"}`}>{detail.status === "cached" ? "缓存命中" : detail.status === "succeeded" ? "成功" : detail.status === "reserved" ? "进行中" : "失败/取消"}</span></td></tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ActivityMetric({ label, value, accounts, guests, note }: { label: string; value: number; accounts: number; guests: number; note: string }) {
  return (
    <div className="px-5 py-5">
      <dt className="text-xs font-semibold text-[#59636c]">{label} · {note}</dt>
      <dd className="mt-2 text-3xl font-semibold tracking-tight text-[#17212b]">{value.toLocaleString("zh-CN")}</dd>
      <dd className="mt-2 text-xs text-[#68717a]">账号 {accounts.toLocaleString("zh-CN")} · 游客 {guests.toLocaleString("zh-CN")}</dd>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <div className="px-3 first:pl-0"><dt className="text-[11px] text-[#68717a]">{label}</dt><dd className="mt-1 text-base font-semibold text-[#17212b]">{value}</dd></div>;
}

function QuotaUsageRow({ label, usage, articleUnit }: { label: string; usage: QuotaFeatureUsage; articleUnit: string }) {
  return (
    <article className="grid gap-3 px-5 py-4 lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-5">
      <div><strong className="text-sm">{label}</strong><p className="mt-1 text-[11px] text-[#68717a]">成功 {usage.succeededActions} · 失败 {usage.failedActions}</p></div>
      <dl className="grid grid-cols-2 gap-y-4 divide-x divide-[#e1e5e9] sm:grid-cols-5">
        <MetricCell label="用户扣量" value={`${usage.chargedActions.toLocaleString("zh-CN")} 次`} />
        <MetricCell label={articleUnit} value={`${usage.generatedArticles.toLocaleString("zh-CN")} 篇`} />
        <MetricCell label="DeepSeek 请求" value={`${usage.providerExecutions.toLocaleString("zh-CN")} 次`} />
        <MetricCell label="Tokens" value={(usage.promptTokens + usage.completionTokens).toLocaleString("zh-CN")} />
        <MetricCell label="估算成本" value={`￥${usage.estimatedCostCny.toFixed(4)}`} />
      </dl>
    </article>
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
  metric: "lookup_generation" | "article_summary" | "full_article_translation";
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
