import type { ImportedArticle } from "@/types/article";
import type { ArticleDifficulty, ArticleTopic, PublicArticle } from "@/types/publicArticle";

export const EDITORIAL_POLICY_VERSION = 3;
export const EDITORIAL_DIFFICULTIES: ArticleDifficulty[] = ["CET-6 / 考研", "雅思 / 托福基础", "雅思 / 托福进阶"];
export const EDITORIAL_QUESTIONS = {
  incomplete: "Does the text have clear evidence of missing article content, an abrupt truncation, a paywall teaser, or references to missing essential sections? A naturally open ending alone is not truncation.",
  contamination: "Does the extracted text contain navigation, newsletter signup, advertising, related-story teasers, exercises, or other non-article material? Normal quotations, editorial notes and source attribution are article material.",
  orphanCaption: "Does a text block contain a photo caption or credit with no corresponding image in the supplied ordered blocks? Image alt text by itself is not an orphan caption.",
  mediaDependent: "Is this primarily a video/audio/gallery page whose text cannot be read as an independent substantive article? An ordinary article mentioning a video is not media-dependent.",
  promotional: "Is the primary purpose advertising, sponsored promotion, product sales, institutional self-promotion or an event announcement rather than substantive independent reading?",
} as const;
export type EditorialCheck = keyof typeof EDITORIAL_QUESTIONS;
export type EditorialDecisions = Record<EditorialCheck, boolean>;
export type EditorialProvider = "deepseek" | "jev-shadow";
export interface EditorialReview {
  version: number;
  status: "passed" | "held";
  completed?: boolean;
  confirmedDefects?: string[];
  checkedAt: string;
  contentHash: string;
  provider: string;
  reasons: string[];
  checks: EditorialDecisions;
  jev?: Partial<Record<EditorialCheck, number>>;
  jevIndependentChecks?: EditorialCheck[];
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  imageCount: number;
  sourceCompletenessVerified?: boolean;
  repair?: import("@/lib/editorialRepair").EditorialRepairEvidence;
}

export function parseEditorialDecisions(value: unknown): EditorialDecisions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("editorial_invalid_decisions");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(EDITORIAL_QUESTIONS)) {
    if (typeof record[key] !== "boolean") throw new Error("editorial_missing_decision");
  }
  return Object.fromEntries(Object.keys(EDITORIAL_QUESTIONS).map((key) => [key, record[key]])) as EditorialDecisions;
}

/** Preserve every character and block; no head/tail sampling for release gates. */
export function editorialChunks(article: ImportedArticle, limit = 16_000): string[] {
  const serialized = article.blocks.map(({ src, ...block }) => JSON.stringify({ ...block, hasImage: block.type === "image" && !!src }));
  const chunks: string[] = [];
  let current = "";
  for (const block of serialized) {
    if (block.length > limit) {
      if (current) { chunks.push(current); current = ""; }
      for (let i = 0; i < block.length; i += limit) chunks.push(block.slice(i, i + limit));
    } else if (current.length + block.length + 1 > limit) {
      chunks.push(current); current = block;
    } else current += (current ? "\n" : "") + block;
  }
  if (current) chunks.push(current);
  if (!chunks.length || chunks.length > 12) throw new Error("全文过长或没有可审核正文，保留候选。");
  return chunks;
}

export function editorialStructureFailures(article: ImportedArticle): string[] {
  const reasons: string[] = [];
  if (!article.blocks.length || !article.text.trim()) reasons.push("缺少正文结构");
  const ids = article.blocks.map((b) => b.id);
  if (new Set(ids).size !== ids.length) reasons.push("正文块编号重复");
  if (article.blocks.some((b) => b.type === "image" && !b.src)) reasons.push("正文图片缺少地址");
  if (article.blocks.some(b=>b.type==='caption' && /(?:image|figure|photo(?:graph)?)\s+(?:(?:has|have)\s+not\s+been\s+loaded|(?:is|was)\s+(?:missing|unavailable|not\s+loaded))|(?:failed|unable)\s+to\s+load\s+(?:the\s+)?(?:image|figure|photo)/i.test(b.text||b.caption||''))) reasons.push("图注明确指出对应图片缺失");
  return reasons;
}

/** Score deficits over seven days; quality gates are applied before this function. */
export function editorialBalanceScore(topic: ArticleTopic, difficulty: ArticleDifficulty, sourceId: string, recent: PublicArticle[]): number {
  const sameTopic = recent.filter((a) => a.recommendation?.topics[0] === topic).length;
  const sameDifficulty = recent.filter((a) => a.recommendation?.difficulty === difficulty).length;
  const sameSource = recent.filter((a) => a.recommendation?.discoverySourceId === sourceId).length;
  return -(sameTopic * 3 + sameDifficulty * 2 + sameSource);
}

export function confirmedEditorialRejection(review: EditorialReview): boolean {
  return review.status === "held" && review.completed === true && !!review.confirmedDefects?.length;
}
