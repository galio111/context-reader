import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";
import type { ArticleRecommendationMetadata, PublicArticle } from "@/types/publicArticle";

const PRESENTATION_COVER_BLOCK_PREFIX = "public-cover-";

export type ArticleMediaState = "cover-and-body" | "cover-only" | "body-as-cover" | "text-only";

export function isPresentationCoverBlock(block: ImportedArticleBlock): boolean {
  return block.type === "image" && block.id.startsWith(PRESENTATION_COVER_BLOCK_PREFIX);
}

export function articleBodyImageBlocks(article: ImportedArticle | null | undefined): ImportedArticleBlock[] {
  return (article?.blocks ?? []).filter((block) => (
    block.type === "image"
    && Boolean(block.src?.trim())
    && !isPresentationCoverBlock(block)
  ));
}

export function firstArticleBodyImage(article: ImportedArticle | null | undefined): ImportedArticleBlock | undefined {
  return articleBodyImageBlocks(article)[0];
}

export function recommendationWithBodyImageFallback(
  recommendation: ArticleRecommendationMetadata | undefined,
  article: ImportedArticle | null | undefined,
  options: { title: string; sourceUrl?: string },
): ArticleRecommendationMetadata | undefined {
  if (!recommendation || recommendation.coverImageUrl?.trim()) return recommendation;
  const bodyImage = firstArticleBodyImage(article);
  const coverImageUrl = bodyImage?.src?.trim() || "";
  if (!coverImageUrl) return recommendation;
  return {
    ...recommendation,
    coverImageUrl,
    coverImageAlt: recommendation.coverImageAlt?.trim() || bodyImage?.alt?.trim() || options.title,
    coverImageSourceUrl: recommendation.coverImageSourceUrl?.trim() || options.sourceUrl?.trim() || article?.url || "",
  };
}

/**
 * Reader receives one presentation-only cover after the title when extraction
 * found no editorial image. Existing body images always win, even when their
 * URL differs from the separately cropped/localized homepage cover.
 */
export function withLeadCoverForImageFreeArticle(
  article: ImportedArticle | null | undefined,
  recommendation: ArticleRecommendationMetadata | undefined,
  articleId: string,
  title: string,
): ImportedArticle | null {
  if (!article) return null;
  const sourceBlocks = article.blocks.filter((block) => !isPresentationCoverBlock(block));
  if (articleBodyImageBlocks({ ...article, blocks: sourceBlocks }).length > 0) {
    return sourceBlocks.length === article.blocks.length ? article : { ...article, blocks: sourceBlocks };
  }
  const coverImageUrl = recommendation?.coverImageUrl?.trim() || "";
  if (!coverImageUrl) {
    return sourceBlocks.length === article.blocks.length ? article : { ...article, blocks: sourceBlocks };
  }

  const headingIndex = sourceBlocks.findIndex((block) => block.type === "heading");
  const insertionIndex = headingIndex >= 0 ? headingIndex + 1 : 0;
  const coverBlock: ImportedArticleBlock = {
    id: `${PRESENTATION_COVER_BLOCK_PREFIX}${articleId}`,
    type: "image",
    src: coverImageUrl,
    alt: recommendation?.coverImageAlt?.trim() || title,
    width: 1280,
    height: 800,
  };
  return {
    ...article,
    blocks: [
      ...sourceBlocks.slice(0, insertionIndex),
      coverBlock,
      ...sourceBlocks.slice(insertionIndex),
    ],
  };
}

export function articleMediaState(article: Pick<PublicArticle, "importedArticle" | "recommendation">): ArticleMediaState {
  const bodyImages = articleBodyImageBlocks(article.importedArticle);
  const explicitCover = article.recommendation?.coverImageUrl?.trim()
    || article.importedArticle?.recommendation?.coverImageUrl?.trim()
    || "";
  if (!explicitCover) return bodyImages.length > 0 ? "body-as-cover" : "text-only";
  if (bodyImages.length === 0) return "cover-only";
  return bodyImages.some((block) => block.src?.trim() === explicitCover) ? "body-as-cover" : "cover-and-body";
}

export function articleHasHomepageImage(article: Pick<PublicArticle, "importedArticle" | "recommendation">): boolean {
  return articleMediaState(article) !== "text-only";
}
