const DAILY_DISCOVERY_TARGET = 60;
import type { EditorialSpend } from "@/lib/editorialBudget";
import { editorialCategoryForArticle, editorialCategoryLabel } from "@/lib/editorialCuration";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { ARTICLE_TOPICS, type PublicArticle } from "@/types/publicArticle";
import { type evaluateJevSamples } from "@/lib/jevCalibration";

export function editorialDailyReport(day: string, articles: PublicArticle[], attempts: number, complete: boolean, spend?: EditorialSpend, calibration?: ReturnType<typeof evaluateJevSamples>, budgetCny?: number, _adoption?: { autoAdopt: boolean; activeChecks: string[] }): { subject: string; text: string } {
  const count = (get: (a: PublicArticle) => string, labels: readonly string[]) => labels.map((label) => `${label}：${articles.filter((a) => get(a) === label).length} 篇`).join("\n");
  return {
    subject: `[Context Reader] ${day} ${complete ? "自动精选完成" : "自动精选未达标"} ${articles.length}/${DAILY_DISCOVERY_TARGET} 篇`,
    text: [
      `${day}（北京时间）已发布并放入首页推荐：${articles.length}/${DAILY_DISCOVERY_TARGET} 篇。`,
      complete ? "本日达到 55–68 篇且四个板块各 13–17 篇的交付门槛；目标约 60 篇。" : "本日未达到数量或板块分布门槛，请检查供给或服务异常；不能将此邮件视为成功通知。",
      budgetCny === Infinity ? "本日为用户授权的不限费用试验日；不因金额或审核次数停止，达到 35 篇即停。来源耗尽或服务不可用仍可能导致缺口。" : budgetCny !== undefined ? `本日费用上限：¥${budgetCny}。` : "",
      spend ? `本日自动精选 AI 费用估算：¥${(spend.actualMicrocny / 1e6).toFixed(4)}（$${(spend.actualMicrousd / 1e6).toFixed(4)}）。涵盖未入选、修复、复审与图片检查，不是只计算入选文章。请求 ${spend.calls} 次，输入 ${spend.inputTokens} tokens，输出 ${spend.outputTokens} tokens。\n${Object.entries(spend.stages).map(([name, v]) => `${name}：${v.calls} 次 / ¥${(v.microcny / 1e6).toFixed(4)}`).join("\n")}\n结果不明请求预留：¥${(spend.reservedMicrocny / 1e6).toFixed(4)}（不是已确认扣费）。${spend.blocked ? "已触发每日成本上限。" : ""}费用按已记录 token 和官方价格估算，以服务商账单为准；不含服务器、存储及历史全库调试。` : "费用记录不可用，不能将缺失视为零成本。",
      "首页类型（互斥统计）：\n" + count((a) => editorialCategoryLabel(editorialCategoryForArticle(a)), ["时事", "科学", "文化", "商业"]),
      "主要题材（每篇只计第一标签）：\n" + count((a) => a.recommendation?.topics[0] || "未分类", ARTICLE_TOPICS),
      "难度：\n" + count((a) => a.recommendation?.difficulty || "未分类", EDITORIAL_DIFFICULTIES),
      `实际审核尝试：${attempts}。修复后通过：${articles.filter((a) => a.recommendation?.editorialReview?.repair).length} 篇。`,
      spend ? "按服务商拆分（包含未入选文章）：\n" + Object.entries(spend.providers || {}).map(([provider, v]) => `${provider}：请求 ${v.calls} 次，已结算用量 ${v.settledCalls} 次；¥${(v.microcny / 1e6).toFixed(4)} / $${(v.microusd / 1e6).toFixed(6)}；未知结果预留 ¥${(v.reservedMicrocny / 1e6).toFixed(4)}`).join("\n") : "",
      "当前模型由后台“模型与调用”控制。每板块 13–17 篇，难度相对均衡。只有数量与板块分布都达标才报告成功；硬上限 ¥1.50，质量不因数量放宽。",
      "逐篇核验（正文和图片均经审核，模型判断仍可能有误）：\n" + articles.map((a, i) => `${i + 1}. ${a.title}\n${a.recommendation?.difficulty} / ${a.recommendation?.topics[0]}\n原文：${a.sourceUrl}`).join("\n"),
      "首页：https://context-reader.com/",
    ].join("\n\n"),
  };
}
