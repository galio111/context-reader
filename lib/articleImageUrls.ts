import type { ImportedArticle } from "@/types/article";

export const FIRST_PARTY_ARTICLE_IMAGE_STORAGE_PATH = "/storage/v1/object/public/public-article-covers/";

export function isFirstPartyArticleImageUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    return new URL(value, "https://context-reader.invalid").pathname.startsWith(
      FIRST_PARTY_ARTICLE_IMAGE_STORAGE_PATH,
    );
  } catch {
    return false;
  }
}

export function isExternalArticleImageUrl(value: string): boolean {
  if (!value.trim() || isFirstPartyArticleImageUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function hasExternalImportedArticleImages(article?: ImportedArticle | null): boolean {
  return Boolean(article?.blocks.some(
    (block) => block.type === "image" && block.src && isExternalArticleImageUrl(block.src),
  ));
}
