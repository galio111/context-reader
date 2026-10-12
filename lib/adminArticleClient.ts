import { adminFetch } from "./adminFetch";
import type { PublicArticle } from "@/types/publicArticle";

export async function loadAdminCandidate(article: PublicArticle): Promise<PublicArticle> {
  if (!article.contentDeferred) return article;
  const response = await adminFetch(`/api/admin/article-candidates?id=${encodeURIComponent(article.id)}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.article?.body?.trim()) throw new Error("候选正文暂时无法读取，请重试。");
  return data.article;
}
