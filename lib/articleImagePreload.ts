import type { ImportedArticle } from "@/types/article";

const ARTICLE_IMAGE_PRIME_TIMEOUT_MS = 1_600;
const MAX_PRIMED_IMAGE_ENTRIES = 64;
const imagePrimeCache = new Map<string, Promise<void>>();

export function getArticleImageSources(article: ImportedArticle | null): string[] {
  return Array.from(new Set(
    article?.blocks
      ?.filter((block) => block.type === "image" && block.src)
      .map((block) => block.src as string) ?? [],
  ));
}

export function primeArticleImage(src: string): Promise<void> {
  if (typeof window === "undefined" || !src) {
    return Promise.resolve();
  }

  const cached = imagePrimeCache.get(src);
  if (cached) {
    return cached;
  }

  const pending = new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const finishAfterDecode = () => {
      if (typeof image.decode !== "function") {
        finish();
        return;
      }
      void image.decode().catch(() => undefined).then(finish);
    };
    const timeoutId = window.setTimeout(finish, ARTICLE_IMAGE_PRIME_TIMEOUT_MS);
    image.decoding = "async";
    image.fetchPriority = "high";
    image.referrerPolicy = "no-referrer";
    image.onload = finishAfterDecode;
    image.onerror = finish;
    image.src = src;
    if (image.complete) finishAfterDecode();
  });

  imagePrimeCache.set(src, pending);
  if (imagePrimeCache.size > MAX_PRIMED_IMAGE_ENTRIES) {
    const oldestKey = imagePrimeCache.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== src) imagePrimeCache.delete(oldestKey);
  }
  return pending;
}

export function primeLeadingArticleImage(article: ImportedArticle | null): Promise<void> {
  const firstSource = getArticleImageSources(article)[0];
  return firstSource ? primeArticleImage(firstSource) : Promise.resolve();
}
