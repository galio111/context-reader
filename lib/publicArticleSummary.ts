import type { PublicArticle } from "@/types/publicArticle";

/** Keep every catalogue item and reader-facing field; editorial evidence stays in Admin/detail. */
export function publicArticleSummary(article: PublicArticle): PublicArticle {
  const r = article.recommendation;
  return {
    id: article.id, title: article.title, summary: article.summary, body: "",
    sourceUrl: article.sourceUrl, sourceName: article.sourceName,
    createdAt: article.createdAt, updatedAt: article.updatedAt,
    ...(r ? { recommendation: {
      coverImageUrl: r.coverImageUrl, coverPreviewDataUrl: r.coverPreviewDataUrl, coverImageAlt: r.coverImageAlt,
      coverImageCredit: r.coverImageCredit, coverImageSourceUrl: r.coverImageSourceUrl,
      difficulty: r.difficulty, cefr: r.cefr, audienceStages: r.audienceStages,
      topics: r.topics, homepageCategory: r.homepageCategory, wordCount: r.wordCount,
      timeliness: r.timeliness, sourceKind: r.sourceKind, classificationSource: r.classificationSource,
    } } : {}),
  };
}
