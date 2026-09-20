import { DAILY_DISCOVERY_TARGET } from "@/lib/discoveryPolicy";
import type { EditorialSpend } from "@/lib/editorialBudget";
import { editorialCategoryForArticle, editorialCategoryLabel } from "@/lib/editorialCuration";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { ARTICLE_TOPICS, type PublicArticle } from "@/types/publicArticle";

export function editorialDailyReport(day: string, articles: PublicArticle[], attempts: number, complete: boolean, spend?: EditorialSpend): { subject: string; text: string } {
  const count = (get: (a: PublicArticle) => string, labels: readonly string[]) => labels.map((label) => `${label}：${articles.filter((a) => get(a) === label).length} 篇`).join("\n");
  return {
    subject: `[Context Reader] ${day} ${complete ? "自动精选完成" : "自动精选未达标"} ${articles.length}/${DAILY_DISCOVERY_TARGET} 篇`,
    text: [
      `${day}（北京时间）已发布并放入首页推荐：${articles.length}/${DAILY_DISCOVERY_TARGET} 篇。`,
      complete ? "本日数量目标已完成。" : "本日未达到数量目标，请检查供给或服务异常；不能将此邮件视为成功通知。",
      spend ? `本日自动精选 AI 费用估算：¥${(spend.actualMicrocny / 1e6).toFixed(4)}（$${(spend.actualMicrousd / 1e6).toFixed(4)}）。涵盖未入选、修复、复审与图片检查，不是只计算入选文章。请求 ${spend.calls} 次，输入 ${spend.inputTokens} tokens，输出 ${spend.outputTokens} tokens。\n${Object.entries(spend.stages).map(([name, v]) => `${name}：${v.calls} 次 / ¥${(v.microcny / 1e6).toFixed(4)}`).join("\n")}\n结果不明请求预留：¥${(spend.reservedMicrocny / 1e6).toFixed(4)}（不是已确认扣费）。${spend.blocked ? "已触发每日成本上限。" : ""}费用按已记录 token 和官方价格估算，以服务商账单为准；不含服务器、存储及历史全库调试。` : "费用记录不可用，不能将缺失视为零成本。",
      "首页类型（互斥统计）：\n" + count((a) => editorialCategoryLabel(editorialCategoryForArticle(a)), ["时事", "科学", "文化", "商业"]),
      "主要题材（每篇只计第一标签）：\n" + count((a) => a.recommendation?.topics[0] || "未分类", ARTICLE_TOPICS),
      "难度：\n" + count((a) => a.recommendation?.difficulty || "未分类", EDITORIAL_DIFFICULTIES),
      `实际审核尝试：${attempts}。修复后通过：${articles.filter((a) => a.recommendation?.editorialReview?.repair).length} 篇。`,
      `本次入选文章中，有 Jev 对照结果：${articles.filter((a) => Object.keys(a.recommendation?.editorialReview?.jev || {}).length > 0).length} 篇；记录 Jev 回退：${articles.filter((a) => a.recommendation?.editorialReview?.provider === "deepseek-fallback").length} 篇。对照结果可能来自之前的审核，不能当作本日 Jev 请求次数。Jev 目前独立审批 0 篇，DeepSeek 仍审核相同正文，并负责分类、难度和图片检查。当天 Jev 调用费用见上方“Jev 对照”；超时等未结算请求包含在结果不明预留中。`,
      "逐篇核验（正文和图片均经审核，模型判断仍可能有误）：\n" + articles.map((a, i) => `${i + 1}. ${a.title}\n${a.recommendation?.difficulty} / ${a.recommendation?.topics[0]}\n原文：${a.sourceUrl}`).join("\n"),
      "首页：https://context-reader.com/",
    ].join("\n\n"),
  };
}
