import { DAILY_DISCOVERY_TARGET } from "@/lib/discoveryPolicy";
import type { EditorialSpend } from "@/lib/editorialBudget";
import { editorialCategoryForArticle, editorialCategoryLabel } from "@/lib/editorialCuration";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { ARTICLE_TOPICS, type PublicArticle } from "@/types/publicArticle";
import { JEV_LABELS, type evaluateJevSamples } from "@/lib/jevCalibration";

export function editorialDailyReport(day: string, articles: PublicArticle[], attempts: number, complete: boolean, spend?: EditorialSpend, calibration?: ReturnType<typeof evaluateJevSamples>, budgetCny?: number, adoption?: { autoAdopt: boolean; activeChecks: string[] }): { subject: string; text: string } {
  const count = (get: (a: PublicArticle) => string, labels: readonly string[]) => labels.map((label) => `${label}：${articles.filter((a) => get(a) === label).length} 篇`).join("\n");
  return {
    subject: `[Context Reader] ${day} ${complete ? "自动精选完成" : "自动精选未达标"} ${articles.length}/${DAILY_DISCOVERY_TARGET} 篇`,
    text: [
      `${day}（北京时间）已发布并放入首页推荐：${articles.length}/${DAILY_DISCOVERY_TARGET} 篇。`,
      complete ? "本日数量目标已完成。" : "本日未达到数量目标，请检查供给或服务异常；不能将此邮件视为成功通知。",
      budgetCny === Infinity ? "本日为用户授权的不限费用试验日；不因金额或审核次数停止，达到 35 篇即停。来源耗尽或服务不可用仍可能导致缺口。" : budgetCny !== undefined ? `本日费用上限：¥${budgetCny}。` : "",
      spend ? `本日自动精选 AI 费用估算：¥${(spend.actualMicrocny / 1e6).toFixed(4)}（$${(spend.actualMicrousd / 1e6).toFixed(4)}）。涵盖未入选、修复、复审与图片检查，不是只计算入选文章。请求 ${spend.calls} 次，输入 ${spend.inputTokens} tokens，输出 ${spend.outputTokens} tokens。\n${Object.entries(spend.stages).map(([name, v]) => `${name}：${v.calls} 次 / ¥${(v.microcny / 1e6).toFixed(4)}`).join("\n")}\n结果不明请求预留：¥${(spend.reservedMicrocny / 1e6).toFixed(4)}（不是已确认扣费）。${spend.blocked ? "已触发每日成本上限。" : ""}费用按已记录 token 和官方价格估算，以服务商账单为准；不含服务器、存储及历史全库调试。` : "费用记录不可用，不能将缺失视为零成本。",
      "首页类型（互斥统计）：\n" + count((a) => editorialCategoryLabel(editorialCategoryForArticle(a)), ["时事", "科学", "文化", "商业"]),
      "主要题材（每篇只计第一标签）：\n" + count((a) => a.recommendation?.topics[0] || "未分类", ARTICLE_TOPICS),
      "难度：\n" + count((a) => a.recommendation?.difficulty || "未分类", EDITORIAL_DIFFICULTIES),
      `实际审核尝试：${attempts}。修复后通过：${articles.filter((a) => a.recommendation?.editorialReview?.repair).length} 篇。`,
      spend ? "按服务商拆分（包含未入选文章）：\n" + Object.entries(spend.providers || {}).map(([provider, v]) => `${provider}：请求 ${v.calls} 次，已结算用量 ${v.settledCalls} 次；¥${(v.microcny / 1e6).toFixed(4)} / $${(v.microusd / 1e6).toFixed(6)}；未知结果预留 ¥${(v.reservedMicrocny / 1e6).toFixed(4)}`).join("\n") : "",
      spend ? `DeepSeek 专门验证 Jev 的费用：¥${((spend.stages["DeepSeek 验证 Jev"]?.microcny || 0) / 1e6).toFixed(4)}。扣除这部分后的当日费用：¥${((spend.actualMicrocny - (spend.stages["DeepSeek 验证 Jev"]?.microcny || 0)) / 1e6).toFixed(4)}。仍包含 Jev、分类、难度、图片、修复和必要回退。此减法不等于已验证的未来账单：未通过替代标准的审核仍须保留，未知结果预留另计。Jev 优先使用 Gateway 返回费用；缺失时按标价估算，人民币按 7.2 换算，免费额度/促销实际扣款以服务商为准。` : "",
      `入选文章中有 Jev 结果：${articles.filter(a => Object.keys(a.recommendation?.editorialReview?.jev || {}).length > 0).length} 篇；含 Jev 独立判断项：${articles.filter(a => (a.recommendation?.editorialReview?.jevIndependentChecks?.length || 0) > 0).length} 篇；Jev 回退：${articles.filter(a => a.recommendation?.editorialReview?.provider === "deepseek-fallback").length} 篇。这些是入选覆盖数，不是当天请求数；旧候选的审核费用可能发生在之前。分类、难度、实际图片和修复仍由 DeepSeek 负责。`,
      calibration?.some(s => s.paired > 0) ? "Jev 与 DeepSeek 参考判断的一致性（不是人工真值准确率；包含未入选文章、同一 URL 去重）：\n" + calibration.map(s => `${JEV_LABELS[s.key]}：有效配对 ${s.paired}，高置信可判 ${s.decided}，一致率 ${s.agreement === null ? "不可计算" : (s.agreement * 100).toFixed(1) + "%"}；相对漏检 ${s.falseNegative}，相对误报 ${s.falsePositive}，缺陷/正常样本 ${s.positives}/${s.negatives}；${s.approved && complete && adoption?.autoAdopt ? "通过替代门槛，次日起该项由 Jev 独立判断，不确定/不可用时回退" : "尚不能作为已验证替代，继续 DeepSeek"}`).join("\n") + "\n替代门槛：每项至少 35 个高置信独立文章配对，其中缺陷至少 5、正常至少 20、来源至少 3；高置信覆盖至少 80%，一致率至少 95%，相对漏检为 0、误报至多 1，并完成当日 35 篇目标。Jev 概率处于 0.05–0.95 的不确定结果继续交给 DeepSeek。没有缺陷样本不能因全票通过就宣称准确。" : `今日没有足够的完整配对样本，不能新增准确度结论。当前已启用独立判断项：${adoption?.activeChecks.join("、") || "无"}；此前通过的项目不会因未重复验证而被重新计作失败。`,
      "逐篇核验（正文和图片均经审核，模型判断仍可能有误）：\n" + articles.map((a, i) => `${i + 1}. ${a.title}\n${a.recommendation?.difficulty} / ${a.recommendation?.topics[0]}\n原文：${a.sourceUrl}`).join("\n"),
      "首页：https://context-reader.com/",
    ].join("\n\n"),
  };
}
