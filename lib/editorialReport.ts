import { editorialCategoryForArticle, editorialCategoryLabel } from "@/lib/editorialCuration";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { ARTICLE_TOPICS, type PublicArticle } from "@/types/publicArticle";

export function editorialDailyReport(day: string, articles: PublicArticle[], attempts: number, complete: boolean): { subject: string; text: string } {
  const count = (get: (a: PublicArticle) => string, labels: readonly string[]) => labels.map((label) => `${label}：${articles.filter((a) => get(a) === label).length} 篇`).join("\n");
  return {
    subject: `[Context Reader] ${day} ${complete ? "自动精选完成" : "自动精选未达标"} ${articles.length}/30 篇`,
    text: [
      `${day}（北京时间）已发布并放入首页推荐：${articles.length}/30 篇。`,
      complete ? "本日数量目标已完成。" : "本日未达到数量目标，请检查供给或服务异常；不能将此邮件视为成功通知。",
      "首页类型（互斥统计）：\n" + count((a) => editorialCategoryLabel(editorialCategoryForArticle(a)), ["时事", "科学", "文化", "商业"]),
      "主要题材（每篇只计第一标签）：\n" + count((a) => a.recommendation?.topics[0] || "未分类", ARTICLE_TOPICS),
      "难度：\n" + count((a) => a.recommendation?.difficulty || "未分类", EDITORIAL_DIFFICULTIES),
      `实际审核尝试：${attempts}。修复后通过：${articles.filter((a) => a.recommendation?.editorialReview?.repair).length} 篇。`,
      "逐篇核验（正文和图片均经审核，模型判断仍可能有误）：\n" + articles.map((a, i) => `${i + 1}. ${a.title}\n${a.recommendation?.difficulty} / ${a.recommendation?.topics[0]}\n原文：${a.sourceUrl}`).join("\n"),
      "首页：https://context-reader.com/",
    ].join("\n\n"),
  };
}
