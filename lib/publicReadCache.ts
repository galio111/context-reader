import { BoundedAsyncCache } from "@/lib/boundedAsyncCache";
import type { PublicArticle } from "@/types/publicArticle";
const globalCache = globalThis as typeof globalThis & { __publicReads?: {
  articles: BoundedAsyncCache<PublicArticle | null>;
  summaries: BoundedAsyncCache<PublicArticle[]>;
} };
export const publicReadCache = globalCache.__publicReads ??= {
  articles: new BoundedAsyncCache(30_000, 64, 24 * 1024 * 1024),
  // The published metadata catalogue exceeds 4 MiB; an undersized cache
  // silently discards it and repeats every database page on the next request.
  summaries: new BoundedAsyncCache(300_000, 1, 16 * 1024 * 1024, true),
};
export function invalidatePublicReadCache(): void {
  publicReadCache.articles.clear();
  publicReadCache.summaries.clear();
}
