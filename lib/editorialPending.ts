import { classifyArticle } from "@/lib/articleClassification";
import { repairEditorialArticle } from "@/lib/editorialRepair";
import { reviewEditorialArticle, type EditorialConfig } from "@/lib/editorialReview";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { saveArticleCandidate } from "@/lib/publicArticles";
import type { PublicArticle } from "@/types/publicArticle";

/** Retry a pending candidate in place, with content/revision guards and the same full release gates. */
export async function retryEditorialCandidate(row: PublicArticle, config: EditorialConfig): Promise<PublicArticle | null> {
  if (!row.importedArticle || !row.recommendation || row.recommendation.rejectedAt) return null;
  const repair = await repairEditorialArticle(row.importedArticle);
  const article = repair.article;
  const options = { sourceUrl: row.sourceUrl, sourceName: row.sourceName, discoveryReview: true, fullTextReview: true, imageDescriptions: article.blocks.filter((b) => b.type === "image").map((b) => b.alt || "").join("; ") };
  let classification = await classifyArticle(article.title, article.text, { ...options, model: process.env.EDITORIAL_DEEPSEEK_MODEL || "deepseek-flash" });
  if (classification.classificationSource !== "model" || classification.difficultyEvidence.confidence !== "high" || !EDITORIAL_DIFFICULTIES.includes(classification.difficulty)) classification = await classifyArticle(article.title, article.text, { ...options, model: process.env.EDITORIAL_DEEPSEEK_REVIEW_MODEL || "deepseek-v4-pro" });
  const review = await reviewEditorialArticle(article, config);
  if (!classification.qualityReview?.eligible || classification.classificationSource !== "model" || classification.difficultyEvidence.confidence === "low" || (classification.topics.includes("科技科学") && classification.qualityReview.specialist)) {
    review.status = "held"; review.reasons.push(classification.qualityReview?.reason || "分类或质量判断未通过");
  }
  if (repair.evidence) {
    review.repair = repair.evidence;
    review.costMicrousd += repair.evidence.costMicrousd;
    review.inputTokens += repair.evidence.inputTokens;
    review.outputTokens += repair.evidence.outputTokens;
  }
  const recommendation = { ...row.recommendation, difficulty: classification.difficulty, cefr: classification.cefr, audienceStages: classification.audienceStages, topics: classification.topics, homepageCategory: classification.homepageCategory, wordCount: classification.wordCount, timeliness: classification.timeliness, classifiedAt: classification.classifiedAt, classificationSource: classification.classificationSource, difficultyEvidence: classification.difficultyEvidence, editorialReview: review };
  return saveArticleCandidate({ id: row.id, expectedUpdatedAt: row.updatedAt, title: row.title, summary: classification.summary, body: article.text, sourceUrl: row.sourceUrl, sourceName: row.sourceName, importedArticle: { ...article, recommendation }, recommendation });
}
