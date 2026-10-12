"use client";
import { useEffect, useMemo, useState } from "react";
import { LoadingStatus } from "./LoadingStatus";
import { adminFetch } from "@/lib/adminFetch";
interface QuotaFeatureUsage {
  unknownCost: number;
  chargedActions: number;
  succeededActions: number;
  failedActions: number;
  generatedArticles: number;
  providerExecutions: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostCny: number;
}

interface Data {
  quotaUsage: {
    summary: QuotaFeatureUsage;
    translation: QuotaFeatureUsage;
    publicCache: { hits: number; articles: number; avoidedDeepSeekCalls: number; actualModelCostCny: number };
    details: Array<{
      id: string;
      userId: string;
      metricKey: "article_summary" | "full_article_translation";
      quotaUnits: number;
      quotaMetric?: string;
      status: string;
      cacheHit: boolean;
      source: string;
      articleKey: string;
      articleLabel: string;
      providerExecutions: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCostCny: number;
      unknownCost: number;
      createdAt: string;
    }>;
  };
}
export function AdminArticleUsageDetails({profiles}: {profiles: Array<Record<string, unknown>>}) {
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const profileByUser=useMemo(()=>new Map(profiles.map(p=>[String(p.user_id),p])),[profiles]);
  useEffect(()=>{ let live=true; void adminFetch("/api/admin/accounts").then(async r=>{if(!r.ok)throw Error();const next=await r.json();if(live)setData(next);}).catch(()=>{if(live)setError("文章扣量记录暂时无法读取。");});return()=>{live=false;};},[retry]);
  if(error)return <p role="alert">{error}<button onClick={()=>{setError("");setRetry(n=>n+1);}}>重试</button></p>;
  if(!data)return <LoadingStatus>正在读取文章扣量记录…</LoadingStatus>;
  return <>
          <details className="mt-6"><summary className="cursor-pointer py-3 text-sm font-semibold">近 30 天摘要、翻译与精选缓存汇总</summary><section className="mt-6 overflow-hidden rounded-2xl bg-white" aria-labelledby="quota-split-title">
            <div className="border-b border-[#e1e5e9] px-5 py-4">
              <h3 id="quota-split-title" className="text-lg font-semibold">扣量与模型成本拆分（近 30 天）</h3>
              <p className="mt-1 text-xs leading-5 text-[#68717a]">用户额度按一次完整动作统计；模型 请求按实际上游流批次统计。普通文章通常只需 1 次，超长文章才会拆成少量批次。</p>
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
                  <MetricCell label="模型 成本" value="￥0.0000" />
                </dl>
              </article>
            </div>
          </section></details>

          <section id="account-details" className="mt-6 scroll-mt-24 overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-[#e1e5e9] px-5 py-5">
              <h3 className="text-[21px] font-semibold">每个用户、每篇文章的扣量记录</h3>
              <p className="mt-1 text-sm leading-6 text-[#4d535a]">最近 30 天最多显示 500 条摘要和全文翻译动作。私人文章只显示匿名正文版本，不保存正文内容。</p>
            </div>
            {data.quotaUsage.details.length === 0 ? <p className="px-5 py-10 text-center text-sm text-[#68717a]">还没有摘要或全文翻译扣量记录。</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="bg-[#f5f7f8] text-xs text-[#59636c]"><tr><th className="px-5 py-3 font-semibold">时间 / 用户</th><th className="px-3 py-3 font-semibold">文章</th><th className="px-3 py-3 font-semibold">类型</th><th className="px-3 py-3 font-semibold">用户扣量</th><th className="px-3 py-3 font-semibold">模型调用</th><th className="px-3 py-3 font-semibold">Tokens / 成本</th><th className="px-5 py-3 font-semibold">结果</th></tr></thead>
                  <tbody className="divide-y divide-[#e1e5e9]">{data.quotaUsage.details.map((detail) => {
                    const profile = profileByUser.get(detail.userId);
                    const totalTokens = detail.promptTokens + detail.completionTokens;
                    return <tr key={detail.id} className="align-top"><td className="px-5 py-4"><time className="block whitespace-nowrap">{new Date(detail.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><span className="mt-1 block text-xs text-[#68717a]">{profile ? profileName(profile) : "账号已删除"}</span></td><td className="max-w-xs px-3 py-4"><strong className="block truncate text-[#27333d]" title={detail.articleLabel}>{detail.articleLabel}</strong><span className="mt-1 block font-mono text-[11px] text-[#7b858d]">{detail.articleKey.slice(0, 12) || "无版本号"}</span></td><td className="px-3 py-4">{detail.metricKey === "article_summary" ? "摘要" : detail.source === "public_cache" ? "精选缓存" : "全文翻译"}</td><td className="px-3 py-4">{detail.quotaUnits > 0 ? `${detail.quotaUnits} ${detail.quotaMetric === "learning_points" ? "点" : "次（旧制）"}` : "0"}</td><td className="px-3 py-4">{detail.providerExecutions} 次调用</td><td className="px-3 py-4">{totalTokens.toLocaleString("zh-CN")}<span className="mt-1 block text-xs text-[#68717a]">￥{detail.estimatedCostCny.toFixed(6)}{detail.unknownCost > 0 ? ` + ${detail.unknownCost} 次待核算` : ""}</span></td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${detail.status === "succeeded" || detail.status === "cached" ? "bg-[#e9f5ee] text-[#17613b]" : "bg-red-50 text-red-700"}`}>{detail.status === "cached" ? "缓存命中" : detail.status === "succeeded" ? "成功" : detail.status === "reserved" ? "进行中" : "失败/取消"}</span></td></tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
</>;
}
function profileName(profile:Record<string,unknown>) {return String(profile.nickname||profile.phone||profile.email||"未设置昵称");}
function MetricCell({ label, value }: { label: string; value: string }) {
  return <div className="px-3 first:pl-0"><dt className="text-[11px] text-[#68717a]">{label}</dt><dd className="mt-1 text-base font-semibold text-[#17212b]">{value}</dd></div>;
}

function QuotaUsageRow({ label, usage, articleUnit }: { label: string; usage: QuotaFeatureUsage; articleUnit: string }) {
  return (
    <article className="grid gap-3 px-5 py-4 lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-5">
      <div><strong className="text-sm">{label}</strong><p className="mt-1 text-[11px] text-[#68717a]">成功 {usage.succeededActions} · 失败 {usage.failedActions}</p></div>
      <dl className="grid grid-cols-2 gap-y-4 divide-x divide-[#e1e5e9] sm:grid-cols-5">
        <MetricCell label="扣量操作数" value={`${usage.chargedActions.toLocaleString("zh-CN")} 次`} />
        <MetricCell label={articleUnit} value={`${usage.generatedArticles.toLocaleString("zh-CN")} 篇`} />
        <MetricCell label="AI 请求" value={`${usage.providerExecutions.toLocaleString("zh-CN")} 次`} />
        <MetricCell label="Tokens" value={(usage.promptTokens + usage.completionTokens).toLocaleString("zh-CN")} />
        <MetricCell label="估算成本" value={`￥${usage.estimatedCostCny.toFixed(6)}${usage.unknownCost ? " + 待核算" : ""}`} />
      </dl>
    </article>
  );
}
