import { BoundedAsyncCache } from "@/lib/boundedAsyncCache";
import type { PublicArticle } from "@/types/publicArticle";
const globalCache = globalThis as typeof globalThis & { __publicReads?: {
  articles: BoundedAsyncCache<PublicArticle | null>;
  summaries: BoundedAsyncCache<PublicArticle[]>;
} };
export const publicReadCache = globalCache.__publicReads ??= {
  articles: new BoundedAsyncCache(30_000, 64, 24 * 1024 * 1024),
  summaries: new BoundedAsyncCache(30_000, 1, 4 * 1024 * 1024),
};
export function invalidatePublicReadCache(): void {
  publicReadCache.articles.clear();
  publicReadCache.summaries.clear();
}
