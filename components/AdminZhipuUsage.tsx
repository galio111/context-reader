import React from "react";
import type { ZhipuUsageSummary } from "@/lib/zhipuUsage";

const features: Record<string, string> = {
  "/api/dictionary-stream": "单独查词", "/api/dictionary": "单独查词",
  "/api/explain-word-stream": "划词解释", "/api/explain-word": "划词解释",
  "/api/translate-article": "全文翻译", "/api/summarize-article": "文章摘要",
  "/api/ask-sentence": "句子追问", "/api/admin/article-classification": "文章分析",
  "/api/admin/article-crawler": "候选采集分析",
};
export function AdminZhipuUsage({ usage, truncated }: { usage: ZhipuUsageSummary; truncated?: boolean }) {
  return <section className="mt-6 overflow-hidden rounded-2xl bg-white" aria-labelledby="zhipu-usage-title">
    <div className="border-b border-[#e1e5e9] px-5 py-4">
      <h3 id="zhipu-usage-title" className="text-lg font-semibold">智谱备用调用</h3>
      <p className="mt-1 text-xs leading-5 text-[#515c66]">过去 30 个上海自然日已写入执行账本的智谱调用。点击后台刷新可更新；调用次数不等于用户扣费次数。</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {[["调用", `${usage.calls} 次`], ["成功 / 失败", `${usage.succeeded} / ${usage.failed}`], ["输入 / 输出 token", `${usage.promptTokens.toLocaleString("zh-CN")} / ${usage.completionTokens.toLocaleString("zh-CN")}`], ["成本估计", `￥${usage.estimatedCostCny.toFixed(4)}`]].map(([label, value]) => <div key={label}><dt className="text-xs text-[#515c66]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#17191c]">{value}</dd></div>)}
      </dl>
    </div>
    {usage.recent.length === 0 ? <p className="px-5 py-6 text-sm text-[#515c66]">这段时间还没有已记录的智谱调用。首次记录后会在这里显示。</p> : <details open>
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-medium text-[#175a8d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1769aa]">最近 {usage.recent.length} 条调用记录{usage.hasMore ? "（最多显示 100 条）" : ""}</summary>
      <ol className="max-h-[32rem] divide-y divide-[#e1e5e9] overflow-y-auto border-t border-[#e1e5e9]">
        {usage.recent.map((row, index) => <li key={`${row.action_id}-${row.created_at}-${index}`} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{features[row.route || ""] || "AI 调用"}</strong><span className={row.status === "succeeded" ? "text-[#17613b]" : "text-[#a22c20]"}>{row.status === "succeeded" ? "成功" : row.status === "failed" ? "失败" : "未完成"}</span></div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#515c66]"><time>{new Date(row.created_at || 0).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time><span className="break-all">{row.model || "未记录模型"}</span><span>输入 {Number(row.prompt_tokens || 0).toLocaleString("zh-CN")} · 输出 {Number(row.completion_tokens || 0).toLocaleString("zh-CN")}</span></p>
          {row.error_code && <p className="mt-1 break-all text-xs text-[#a22c20]">错误代码：{row.error_code}</p>}
        </li>)}
      </ol>
    </details>}
    {truncated && <p className="border-t border-[#e1e5e9] px-5 py-3 text-xs text-[#8d3224]">总账已达到 50,000 条读取上限，智谱统计可能不完整。</p>}
  </section>;
}
