import { editorialCategoryForArticle } from "./editorialCuration";
import { freshnessFailure } from "./discoveryPolicy";
import type { PublicArticle } from "../types/publicArticle";

export function approvedRefreshPool(articles: PublicArticle[], counts: Record<string, number>, attempted: string[] = []) {
  const seen = new Set(attempted);
  return articles.filter(a => a.importedArticle && a.recommendation?.sourceKind === "crawler"
    && !a.recommendation.rejectedAt && a.recommendation.editorialReview?.status === "passed"
    && !seen.has(a.id)
    && !freshnessFailure([a.importedArticle.publishedTime || ""], a.recommendation.timeliness === "time-sensitive"))
    .sort((a,b) => (counts[editorialCategoryForArticle(a)] || 0) - (counts[editorialCategoryForArticle(b)] || 0)
      || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function isolatedPublishFailure(error: unknown): boolean {
  return /已有相同公开文章|候选状态或审核已变化|候选内容在审核后变化|候选同时发生变更|Article candidate was not found/.test(String(error));
}
