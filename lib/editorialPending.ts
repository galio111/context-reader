import { sanitizeImportedArticleContent } from "@/lib/articleContentSanitizer";
import { auditEditorialFlash, cleanEditorialFurniture } from "@/lib/editorialFlash";
import { type EditorialConfig } from "@/lib/editorialReview";
import { EDITORIAL_DIFFICULTIES } from "@/lib/editorialReviewPolicy";
import { saveArticleCandidate } from "@/lib/publicArticles";
import type { PublicArticle } from "@/types/publicArticle";

/** Retry a pending candidate in place, with content/revision guards and the same full release gates. */
export async function retryEditorialCandidate(row: PublicArticle, _config: EditorialConfig): Promise<PublicArticle | null> {
  if (!row.importedArticle || !row.recommendation || row.recommendation.rejectedAt) return null;
  const article = sanitizeImportedArticleContent(cleanEditorialFurniture(row.importedArticle));
  const {classification,review} = await auditEditorialFlash(article);
  if (!EDITORIAL_DIFFICULTIES.includes(classification.difficulty)) return null;
  const recommendation = { ...row.recommendation, difficulty: classification.difficulty, cefr: classification.cefr, audienceStages: classification.audienceStages, topics: classification.topics, homepageCategory: classification.homepageCategory, wordCount: classification.wordCount, timeliness: classification.timeliness, classifiedAt: classification.classifiedAt, classificationSource: classification.classificationSource, reviewNotes: classification.reviewNotes, difficultyEvidence: classification.difficultyEvidence, editorialReview: review };
  return saveArticleCandidate({ id: row.id, expectedUpdatedAt: row.updatedAt, title: row.title, summary: classification.summary, body: article.text, sourceUrl: row.sourceUrl, sourceName: row.sourceName, importedArticle: { ...article, recommendation }, recommendation });
}
