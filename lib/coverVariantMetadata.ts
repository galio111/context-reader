import type { ArticleRecommendationMetadata } from "../types/publicArticle";

export function validCoverVariants(value: unknown, sourceUrl: string): value is NonNullable<ArticleRecommendationMetadata["coverVariants"]> {
  if (!value || typeof value !== "object") return false;
  const v = value as NonNullable<ArticleRecommendationMetadata["coverVariants"]>;
  if (v.version !== 1 || v.sourceUrl !== sourceUrl || !Number.isInteger(v.width) || !Number.isInteger(v.height)
    || v.width <= 0 || v.height <= 0 || v.width * v.height > 50_000_000 || !Array.isArray(v.items) || !v.items.length || v.items.length > 6) return false;
  try {
    const source = new URL(sourceUrl);
    let previous = 0;
    return v.items.every(item => {
      const url = new URL(item.url);
      const valid = url.origin === source.origin && (item.url === sourceUrl || /^\/storage\/v1\/object\/public\/public-article-covers\/variants\/v1\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/.test(url.pathname))
        && Number.isInteger(item.width) && Number.isInteger(item.height) && item.width > previous && item.width <= v.width
        && item.height > 0 && Math.abs(item.height - item.width * v.height / v.width) <= 1;
      previous = item.width;
      return valid;
    }) && v.items.at(-1)?.url === sourceUrl && v.items.at(-1)?.width === v.width;
  } catch { return false; }
}
