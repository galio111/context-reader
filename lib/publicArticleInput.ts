import {
  ARTICLE_AUDIENCE_STAGES,
  ARTICLE_CEFR_LEVELS,
  ARTICLE_DIFFICULTIES,
  ARTICLE_TOPICS,
  type ArticleManualField,
  type ArticleRecommendationMetadata,
  type PublicArticleCandidateInput,
  type PublicArticleInput,
} from "@/types/publicArticle";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_FIELDS: ArticleManualField[] = [
  "summary",
  "difficulty",
  "cefr",
  "audienceStages",
  "topics",
  "homepageCategory",
  "timeliness",
  "reviewNotes",
];

function isBoundedString(value: unknown, maxLength: number, required = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (!required || value.trim().length > 0);
}

function isHttpUrl(value: string): boolean {
  if (!value.trim()) {
    return true;
  }
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isRecommendation(value: unknown): value is ArticleRecommendationMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ArticleRecommendationMetadata>;
  return (
    isBoundedString(item.coverImageUrl, 2_048) &&
    isHttpUrl(item.coverImageUrl) &&
    (item.coverImageAlt === undefined || isBoundedString(item.coverImageAlt, 300)) &&
    (item.coverImageSourceUrl === undefined || (isBoundedString(item.coverImageSourceUrl, 2_048) && isHttpUrl(item.coverImageSourceUrl))) &&
    (item.coverImageCredit === undefined || isBoundedString(item.coverImageCredit, 300)) &&
    typeof item.difficulty === "string" && ARTICLE_DIFFICULTIES.includes(item.difficulty) &&
    typeof item.cefr === "string" && ARTICLE_CEFR_LEVELS.includes(item.cefr) &&
    Array.isArray(item.audienceStages) && item.audienceStages.length <= 4 &&
    item.audienceStages.every((stage) => typeof stage === "string" && ARTICLE_AUDIENCE_STAGES.includes(stage)) &&
    Array.isArray(item.topics) && item.topics.length >= 1 && item.topics.length <= 3 &&
    item.topics.every((topic) => typeof topic === "string" && ARTICLE_TOPICS.includes(topic)) &&
    (item.homepageCategory === undefined || ["时事", "科技", "文化", "商业"].includes(item.homepageCategory)) &&
    typeof item.wordCount === "number" && Number.isInteger(item.wordCount) && item.wordCount >= 1 && item.wordCount <= 200_000 &&
    (item.readingMinutes === undefined || (
      typeof item.readingMinutes === "number" && Number.isFinite(item.readingMinutes) && item.readingMinutes >= 1 && item.readingMinutes <= 240
    )) &&
    (item.timeliness === "evergreen" || item.timeliness === "time-sensitive") &&
    (item.sourceKind === "manual-paste" || item.sourceKind === "manual-url" || item.sourceKind === "local-saved" || item.sourceKind === "crawler") &&
    (item.classificationSource === "model" || item.classificationSource === "heuristic" || item.classificationSource === "manual") &&
    (item.classifiedAt === undefined || isBoundedString(item.classifiedAt, 80)) &&
    (item.reviewNotes === undefined || isBoundedString(item.reviewNotes, 500)) &&
    (item.rejectedAt === undefined || isBoundedString(item.rejectedAt, 80)) &&
    (item.manualFields === undefined || (
      Array.isArray(item.manualFields) &&
      item.manualFields.length <= MANUAL_FIELDS.length &&
      item.manualFields.every((field) => typeof field === "string" && MANUAL_FIELDS.includes(field as ArticleManualField))
    )) &&
    (item.difficultyEvidence === undefined || (
      typeof item.difficultyEvidence === "object" &&
      item.difficultyEvidence !== null &&
      typeof item.difficultyEvidence.wordCount === "number" &&
      typeof item.difficultyEvidence.sentenceCount === "number" &&
      typeof item.difficultyEvidence.averageSentenceLength === "number" &&
      typeof item.difficultyEvidence.longWordRatio === "number" &&
      typeof item.difficultyEvidence.lexicalDiversity === "number" &&
      typeof item.difficultyEvidence.complexSentenceRatio === "number" &&
      isBoundedString(item.difficultyEvidence.sourcePrior, 500, true) &&
      typeof item.difficultyEvidence.abstractness === "number" &&
      item.difficultyEvidence.abstractness >= 1 &&
      item.difficultyEvidence.abstractness <= 5 &&
      typeof item.difficultyEvidence.backgroundKnowledge === "number" &&
      item.difficultyEvidence.backgroundKnowledge >= 1 &&
      item.difficultyEvidence.backgroundKnowledge <= 5 &&
      Array.isArray(item.difficultyEvidence.challengingTerms) &&
      item.difficultyEvidence.challengingTerms.length <= 8 &&
      item.difficultyEvidence.challengingTerms.every((term) => isBoundedString(term, 80, true)) &&
      isBoundedString(item.difficultyEvidence.rationale, 500, true)
    ))
  );
}

export function isSafePublicArticleInput(value: unknown, allowId = false): value is PublicArticleCandidateInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<PublicArticleCandidateInput>;
  if (
    (allowId && input.id !== undefined && (!isBoundedString(input.id, 40, true) || !UUID_PATTERN.test(input.id))) ||
    !isBoundedString(input.title, 200, true) ||
    !isBoundedString(input.body, 500_000, true) ||
    !isBoundedString(input.summary, 1_000) ||
    (input.sourceUrl !== undefined && (!isBoundedString(input.sourceUrl, 2_048) || !isHttpUrl(input.sourceUrl))) ||
    (input.sourceName !== undefined && !isBoundedString(input.sourceName, 200)) ||
    (input.recommendation !== undefined && !isRecommendation(input.recommendation)) ||
    (input.explanations !== undefined && (!Array.isArray(input.explanations) || input.explanations.length > 3_000)) ||
    (input.articleTranslations !== undefined && (!Array.isArray(input.articleTranslations) || input.articleTranslations.length > 2_000))
  ) {
    return false;
  }

  if (input.importedArticle !== undefined && input.importedArticle !== null) {
    if (
      typeof input.importedArticle !== "object" ||
      !Array.isArray(input.importedArticle.blocks) ||
      input.importedArticle.blocks.length > 5_000 ||
      input.importedArticle.blocks.some((block) => !block || typeof block !== "object")
    ) {
      return false;
    }
  }

  if (input.explanations?.some((item) => (
    !item ||
    typeof item !== "object" ||
    !isBoundedString(item.cacheKey, 1_000, true) ||
    !isBoundedString(item.word, 200, true) ||
    !isBoundedString(item.sentence, 2_000, true) ||
    !item.explanation ||
    typeof item.explanation !== "object"
  ))) {
    return false;
  }

  if (input.articleTranslations?.some((item) => (
    !item ||
    typeof item !== "object" ||
    !isBoundedString(item.cacheKey, 1_000, true) ||
    !Array.isArray(item.translations) ||
    item.translations.length > 5_000 ||
    item.translations.some((translation) => (
      !translation ||
      typeof translation !== "object" ||
      !isBoundedString(translation.id, 200, true) ||
      !isBoundedString(translation.translation, 5_000, true)
    ))
  ))) {
    return false;
  }

  return true;
}

export function hasRecommendationCover(input: Pick<PublicArticleInput, "recommendation" | "importedArticle">): boolean {
  return Boolean((input.recommendation?.coverImageUrl || input.importedArticle?.recommendation?.coverImageUrl || "").trim());
}
