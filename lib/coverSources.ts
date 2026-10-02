import type { PublicArticle } from "@/types/publicArticle";

export interface CoverSource { src: string; srcSet?: string; sizes: string }

/** One responsive geometry for parser, warmup and visible image. Retains DPR,
 * original variants, object-fit:cover and both existing overscan layers. */
export function coverSource(article: PublicArticle, featured = false): CoverSource | null {
  const src = article.recommendation?.coverImageUrl?.trim();
  if (!src) return null;
  const variants = article.recommendation?.coverVariants;
  const valid = variants?.version === 1 && variants.sourceUrl === src ? variants : undefined;
  const scale = 1.11112 * 1.06 * Math.max(1, (valid ? valid.width / valid.height : 4 / 3) / (4 / 3));
  const grid = "min(1320px, calc(100vw - 2 * clamp(30px, 6.4vw, 124px)))";
  const mobile = featured ? `calc(${grid} * ${scale})` : `calc((${grid} - 14px) * ${scale / 2})`;
  const desktop = featured
    ? `calc((${grid} - clamp(34px, 5vw, 84px)) * ${scale * 1.5 / 2.32})`
    : `calc((${grid} - 2 * clamp(20px, 2.55vw, 40px)) * ${scale / 3})`;
  return { src, srcSet: valid?.items.map(item => `${item.url} ${item.width}w`).join(", "), sizes: `(max-width: 900px) ${mobile}, ${desktop}` };
}
