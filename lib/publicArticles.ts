import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  decodeHtmlEntitiesRepeated,
  isRemoteImportedArticle,
  sanitizeImportedArticleContent,
  trimTrailingWebsiteText,
} from "@/lib/articleContentSanitizer";
import { countArticleEnglishWords } from "@/lib/articleWordCount";
import { recommendationWithBodyImageFallback, withLeadCoverForImageFreeArticle } from "@/lib/articleMedia";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { createArticleTranslationBatches } from "@/lib/articleTranslationBatching";
import { createArticleTranslationCacheKey } from "@/lib/articleTranslationIdentity";
import { localizePublicArticleInputCover } from "@/lib/publicArticleCovers";
import type {
  ArticleRecommendationMetadata,
  PublicArticle,
  PublicArticleCandidateInput,
  PublicArticleInput,
  PublicArticleTranslation,
  PublicExplanation,
} from "@/types/publicArticle";
import { ARTICLE_DIFFICULTIES } from "@/types/publicArticle";
import { candidateOrder, REJECTION_REASONS } from "@/lib/discoveryPolicy";
import { ORDER_KEY, readDiscoverySetting } from "@/lib/discoveryStore";

interface SupabaseArticleRow {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source_url: string | null;
  source_name: string | null;
  imported_article?: ImportedArticle | null;
  recommendation?: ArticleRecommendationMetadata | null;
  published?: boolean;
  created_at: string;
  updated_at: string;
}

interface SupabaseExplanationRow {
  id: string;
  article_id: string;
  cache_key: string;
  word: string;
  sentence: string;
  explanation: PublicExplanation["explanation"];
}

interface SupabaseArticleTranslationRow {
  id: string;
  article_id: string;
  cache_key: string;
  translations: PublicArticleTranslation["translations"];
}

interface SupabaseRequestInit extends RequestInit {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
}

function supabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseFetch<T>(path: string, init: SupabaseRequestInit = {}): Promise<T> {
  const { url, key } = supabaseConfig();
  const hasNextDataCache = Boolean(init.next);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...(hasNextDataCache ? {} : { cache: "no-store" as const }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Supabase request failed", { status: response.status, path, detail: message.slice(0, 500) });
    throw new Error("Public article storage request failed.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function recommendationFromRow(row: SupabaseArticleRow, body: string): ArticleRecommendationMetadata | undefined {
  const recommendation = row.recommendation ?? row.imported_article?.recommendation ?? undefined;
  if (!recommendation) {
    return undefined;
  }
  const wordCount = recommendation.wordCount || countArticleEnglishWords(body || row.imported_article?.text || "");
  const difficultyIndex = ARTICLE_DIFFICULTIES.indexOf(recommendation.difficulty);
  const automaticCefr = (["A2", "B1", "B2", "C1", "C1", "C2"] as const)[difficultyIndex];
  const cefrWasManuallySet =
    recommendation.classificationSource === "manual"
    || recommendation.manualFields?.includes("cefr");
  return {
    ...recommendation,
    wordCount,
    ...(!cefrWasManuallySet && automaticCefr ? { cefr: automaticCefr } : {}),
  };
}

function mapArticle(
  row: SupabaseArticleRow,
  explanations: PublicExplanation[] = [],
  articleTranslations: PublicArticleTranslation[] = [],
): PublicArticle {
  const title = decodeHtmlEntitiesRepeated(row.title);
  const summary = decodeHtmlEntitiesRepeated(row.summary);
  const sourceName = decodeHtmlEntitiesRepeated(row.source_name ?? "");
  const importedArticle = isRemoteImportedArticle(row.imported_article)
    ? sanitizeImportedArticleContent(row.imported_article)
    : row.imported_article;
  const body = importedArticle?.text.trim()
    || (row.body ? decodeHtmlEntitiesRepeated(trimTrailingWebsiteText(row.body, row.source_url || row.imported_article?.url)) : "");
  const recommendation = recommendationWithBodyImageFallback(
    recommendationFromRow(row, body),
    importedArticle,
    { title, sourceUrl: row.source_url ?? importedArticle?.url ?? "" },
  );
  const readerArticle = withLeadCoverForImageFreeArticle(importedArticle, recommendation, row.id, title);
  return {
    id: row.id,
    title,
    summary,
    body,
    sourceUrl: row.source_url ?? "",
    sourceName,
    ...(readerArticle ? { importedArticle: readerArticle } : {}),
    ...(recommendation ? { recommendation } : {}),
    explanations,
    articleTranslations,
    ...(typeof row.published === "boolean" ? { published: row.published } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExplanation(row: SupabaseExplanationRow): PublicExplanation {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    word: row.word,
    sentence: row.sentence,
    explanation: row.explanation,
  };
}

function mapArticleTranslation(row: SupabaseArticleTranslationRow): PublicArticleTranslation {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    translations: row.translations,
  };
}

function encodeFilter(value: string): string {
  return encodeURIComponent(value.trim());
}

function canonicalArticleIdentityUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|referrer$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizedArticleIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function articleBodyIdentity(value: string): string {
  const normalized = normalizedArticleIdentityText(value);
  if (normalized.length < 240) return "";
  return `${normalized.length}:${normalized.slice(0, 1200)}:${normalized.slice(-400)}`;
}

function invalidatePublicRecommendations(): void {
  revalidateTag("public-article-summaries");
  revalidatePath("/");
}

function plainTextBlocks(title: string, body: string): ImportedArticleBlock[] {
  const blocks: ImportedArticleBlock[] = [{ id: "block-0", type: "heading", text: title.trim() }];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    blocks.push({ id: `block-${blocks.length}`, type: "paragraph", text: line });
  }
  return blocks;
}

function importedArticleForInput(input: PublicArticleInput): ImportedArticle {
  const sourceUrl = input.sourceUrl?.trim() || input.importedArticle?.url || "";
  const sourceName = input.sourceName?.trim() || input.importedArticle?.siteName || "Context Reader";
  const recommendation = input.recommendation ?? input.importedArticle?.recommendation;
  const storedRecommendation = recommendation
    ? { ...recommendation, wordCount: countArticleEnglishWords(input.body) }
    : undefined;
  if (input.importedArticle) {
    return {
      ...input.importedArticle,
      title: input.title.trim(),
      url: sourceUrl,
      siteName: sourceName,
      text: input.body,
      ...(storedRecommendation ? { recommendation: storedRecommendation } : {}),
    };
  }
  return {
    title: input.title.trim(),
    url: sourceUrl,
    siteName: sourceName,
    text: input.body,
    blocks: plainTextBlocks(input.title, input.body),
    ...(storedRecommendation ? { recommendation: storedRecommendation } : {}),
  };
}

function articleRowPayload(input: PublicArticleInput, published: boolean) {
  const importedArticle = importedArticleForInput(input);
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    body: input.body,
    source_url: input.sourceUrl?.trim() || importedArticle.url || "",
    source_name: input.sourceName?.trim() || importedArticle.siteName || "",
    imported_article: importedArticle,
    published,
  };
}

async function insertPublicExplanations(articleId: string, explanations: PublicExplanation[]): Promise<void> {
  const validExplanations = explanations.filter(
    (item) => item.cacheKey && item.word.trim() && item.sentence.trim() && item.explanation,
  );
  if (validExplanations.length === 0) {
    return;
  }
  await supabaseFetch("public_explanations", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(validExplanations.map((item) => ({
      article_id: articleId,
      cache_key: item.cacheKey,
      word: item.word.trim(),
      sentence: item.sentence.trim(),
      explanation: item.explanation,
    }))),
  });
}

async function insertPublicArticleTranslations(
  articleId: string,
  articleTranslations: PublicArticleTranslation[],
): Promise<void> {
  const validArticleTranslations = articleTranslations.filter(
    (item) => item.cacheKey && Array.isArray(item.translations) && item.translations.length > 0,
  );
  if (validArticleTranslations.length === 0) {
    return;
  }
  await supabaseFetch("public_article_translations", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(validArticleTranslations.map((item) => ({
      article_id: articleId,
      cache_key: item.cacheKey,
      translations: item.translations,
    }))),
  });
}

async function mergeArticleCaches(articleId: string, input: PublicArticleInput): Promise<void> {
  await Promise.all([
    insertPublicExplanations(articleId, input.explanations ?? []),
    insertPublicArticleTranslations(articleId, input.articleTranslations ?? []),
  ]);
}

async function listPublicArticleTranslations(articleId: string): Promise<PublicArticleTranslation[]> {
  try {
    const rows = await supabaseFetch<SupabaseArticleTranslationRow[]>(
      `public_article_translations?select=id,article_id,cache_key,translations&article_id=eq.${encodeURIComponent(articleId)}&order=created_at.asc`,
    );
    return rows.map(mapArticleTranslation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("public_article_translations")) {
      console.warn("public_article_translations table is not available; returning public article without translation cache.");
      return [];
    }
    throw error;
  }
}

async function getManagedArticleRow(articleId: string, published?: boolean): Promise<SupabaseArticleRow | null> {
  const publishedFilter = typeof published === "boolean" ? `&published=eq.${published}` : "";
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(articleId)}${publishedFilter}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getPublishedArticleTranslation(
  articleId: string,
  cacheKey: string,
): Promise<{ article: PublicArticle; translation: PublicArticleTranslation; blockCount: number; providerBatchCount: number } | null> {
  const row = await getManagedArticleRow(articleId, true);
  if (!row) return null;
  const article = mapArticle(row);
  const blocks = createArticleTranslationBlocks(article.body, article.importedArticle ?? null);
  const expectedCacheKey = createArticleTranslationCacheKey(blocks);
  if (!blocks.length || cacheKey !== expectedCacheKey) return null;
  const translations = await listPublicArticleTranslations(articleId);
  const translation = translations.find((item) => item.cacheKey === expectedCacheKey);
  if (!translation) return null;
  const ids = new Set(translation.translations.map((item) => item.id));
  if (!blocks.every((block) => ids.has(block.id))) return null;
  return { article, translation, blockCount: blocks.length, providerBatchCount: createArticleTranslationBatches(blocks).length };
}

export async function replaceManagedArticleTranslation(
  articleId: string,
  input: PublicArticleTranslation,
): Promise<{ translation: PublicArticleTranslation; blockCount: number; articleTitle: string }> {
  const row = await getManagedArticleRow(articleId);
  if (!row) throw new Error("文章不存在或已经被删除。");
  const article = mapArticle(row);
  const blocks = createArticleTranslationBlocks(article.body, article.importedArticle ?? null);
  const expectedCacheKey = createArticleTranslationCacheKey(blocks);
  if (!blocks.length) throw new Error("文章没有可上传翻译的正文段落。");
  if (input.cacheKey !== expectedCacheKey) throw new Error("正文已经变化，请刷新文章后重新检查译文。");
  const translationById = new Map(input.translations.map((item) => [item.id, item.translation.trim()]));
  if (
    translationById.size !== blocks.length
    || blocks.some((block) => !translationById.get(block.id))
  ) {
    throw new Error(`译文必须完整对应 ${blocks.length} 个正文段落。`);
  }
  const translation: PublicArticleTranslation = {
    cacheKey: expectedCacheKey,
    translations: blocks.map((block) => ({ id: block.id, translation: translationById.get(block.id) ?? "" })),
  };
  await insertPublicArticleTranslations(articleId, [translation]);
  await supabaseFetch(
    `public_article_translations?article_id=eq.${encodeURIComponent(articleId)}&cache_key=neq.${encodeURIComponent(expectedCacheKey)}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  return { translation, blockCount: blocks.length, articleTitle: article.title };
}

async function listPublicExplanations(articleId: string): Promise<PublicExplanation[]> {
  const rows = await supabaseFetch<SupabaseExplanationRow[]>(
    `public_explanations?select=id,article_id,cache_key,word,sentence,explanation&article_id=eq.${encodeURIComponent(articleId)}&order=created_at.asc`,
  );
  return rows.map(mapExplanation);
}

async function findDuplicateArticleRow(input: PublicArticleInput, published: boolean): Promise<SupabaseArticleRow | null> {
  const sourceUrl = input.sourceUrl?.trim() || input.importedArticle?.url || "";
  const identityFilter = sourceUrl ? `source_url=eq.${encodeFilter(sourceUrl)}` : `title=eq.${encodeFilter(input.title)}`;
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&published=eq.${published}&${identityFilter}&limit=1`,
  );
  if (rows[0]) return rows[0];

  const candidates = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&published=eq.${published}&order=updated_at.desc&limit=250`,
  );
  const canonicalUrl = canonicalArticleIdentityUrl(sourceUrl);
  const titleIdentity = normalizedArticleIdentityText(input.title);
  const bodyIdentity = articleBodyIdentity(input.body || input.importedArticle?.text || "");
  return candidates.find((candidate) => {
    const candidateUrl = canonicalArticleIdentityUrl(candidate.source_url || candidate.imported_article?.url || "");
    if (canonicalUrl && candidateUrl && canonicalUrl === candidateUrl) return true;
    if (titleIdentity && titleIdentity === normalizedArticleIdentityText(candidate.title)) return true;
    return Boolean(bodyIdentity && bodyIdentity === articleBodyIdentity(candidate.body || candidate.imported_article?.text || ""));
  }) ?? null;
}

export async function listPublicArticles(options: { includeImportedArticle?: boolean } = {}): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    options.includeImportedArticle
      ? "public_articles?select=id,title,summary,body,source_url,source_name,imported_article,created_at,updated_at&published=eq.true&order=updated_at.desc"
      : "public_articles?select=id,title,summary,body,source_url,source_name,recommendation:imported_article->recommendation,created_at,updated_at&published=eq.true&order=updated_at.desc",
  );
  return rows.map((row) => mapArticle(row));
}

/**
 * Homepage-safe recommendation catalogue. Deliberately excludes article bodies,
 * structured blocks and preload caches so a homepage render cannot amplify
 * database egress. The full article is loaded only after explicit hover/focus
 * intent or a click through getPublicArticle().
 */
export async function listPublicArticleSummaries(): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    "public_articles?select=id,title,summary,source_url,source_name,recommendation:imported_article->recommendation,created_at,updated_at&published=eq.true&order=updated_at.desc",
    { next: { revalidate: 300, tags: ["public-article-summaries"] } },
  );
  return rows.map((row) => mapArticle(row));
}

export async function getPublicArticle(id: string): Promise<PublicArticle | null> {
  const articleRows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`,
  );
  const article = articleRows[0];
  if (!article) {
    return null;
  }
  const [explanationRows, articleTranslations] = await Promise.all([
    supabaseFetch<SupabaseExplanationRow[]>(
      `public_explanations?select=id,article_id,cache_key,word,sentence,explanation&article_id=eq.${encodeURIComponent(id)}&order=created_at.asc`,
    ),
    listPublicArticleTranslations(id),
  ]);
  return mapArticle(article, explanationRows.map(mapExplanation), articleTranslations);
}

export async function listArticleCandidates(options: { includeRejected?: boolean } = {}): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    "public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&published=eq.false&order=updated_at.desc",
  );
  const articles = rows.map((row) => mapArticle(row));
  const visible = options.includeRejected ? articles : articles.filter((article) => !article.recommendation?.rejectedAt);
  return candidateOrder(visible, await readDiscoverySetting<string[]>(ORDER_KEY, []));
}

export async function listRejectedArticleCandidates(): Promise<PublicArticle[]> {
  const articles = await listArticleCandidates({ includeRejected: true });
  return articles.filter((article) => Boolean(article.recommendation?.rejectedAt));
}

export async function saveArticleCandidate(input: PublicArticleCandidateInput): Promise<PublicArticle> {
  const storedInput = await localizePublicArticleInputCover(input);
  let existing: SupabaseArticleRow | null = null;
  if (storedInput.id) {
    const rows = await supabaseFetch<SupabaseArticleRow[]>(
      `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(storedInput.id)}&published=eq.false&limit=1`,
    );
    existing = rows[0] ?? null;
  } else {
    existing = await findDuplicateArticleRow(storedInput, false);
  }

  let row: SupabaseArticleRow | undefined;
  if (existing) {
    const rows = await supabaseFetch<SupabaseArticleRow[]>(
      `public_articles?id=eq.${encodeURIComponent(existing.id)}&published=eq.false`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(articleRowPayload(storedInput, false)),
      },
    );
    row = rows[0];
  } else {
    const rows = await supabaseFetch<SupabaseArticleRow[]>("public_articles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(articleRowPayload(storedInput, false)),
    });
    row = rows[0];
  }
  if (!row) {
    throw new Error("Supabase did not return the saved article candidate.");
  }
  await mergeArticleCaches(row.id, storedInput);
  return mapArticle(row);
}

export async function publishArticleCandidate(id: string): Promise<PublicArticle> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(id)}&published=eq.false&limit=1`,
  );
  const candidate = rows[0];
  if (!candidate) {
    throw new Error("Article candidate was not found.");
  }
  const importedArticle = isRemoteImportedArticle(candidate.imported_article)
    ? sanitizeImportedArticleContent(candidate.imported_article)
    : candidate.imported_article;
  const candidateBody = importedArticle
    ? trimTrailingWebsiteText(candidate.body ?? importedArticle.text, candidate.source_url || importedArticle.url)
    : candidate.body ?? "";
  const candidateInput: PublicArticleInput = {
    title: candidate.title,
    summary: candidate.summary,
    body: candidateBody,
    sourceUrl: candidate.source_url ?? "",
    sourceName: candidate.source_name ?? "",
    importedArticle,
    recommendation: importedArticle?.recommendation,
  };
  const storedCandidateInput = await localizePublicArticleInputCover(candidateInput);
  const storedCandidateImportedArticle = importedArticleForInput(storedCandidateInput);
  const duplicate = await findDuplicateArticleRow(storedCandidateInput, true);
  if (duplicate && duplicate.id !== candidate.id) {
    const [explanations, articleTranslations] = await Promise.all([
      listPublicExplanations(candidate.id),
      listPublicArticleTranslations(candidate.id),
    ]);
    const updated = await updatePublicArticle(duplicate.id, {
      ...storedCandidateInput,
      explanations,
      articleTranslations,
    });
    await deleteArticleCandidate(candidate.id);
    return updated;
  }

  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}&published=eq.false`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      published: true,
      body: candidateBody,
      imported_article: storedCandidateImportedArticle,
    }),
  });
  const article = await getPublicArticle(id);
  if (!article) {
    throw new Error("Candidate was published but could not be reloaded.");
  }
  invalidatePublicRecommendations();
  return article;
}

export async function deleteArticleCandidate(id: string): Promise<void> {
  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}&published=eq.false`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function setArticleCandidateRejected(id: string, rejected: boolean, reason?: string): Promise<PublicArticle> {
  if (reason && !REJECTION_REASONS.some((value) => value === reason)) throw new Error("请选择有效的不精选原因。");
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(id)}&published=eq.false&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("候选文章不存在或已经发布。");
  const article = mapArticle(row);
  const recommendation = article.recommendation ?? article.importedArticle?.recommendation;
  if (!recommendation) throw new Error("候选文章缺少推荐资料。");
  return saveArticleCandidate({
    id: article.id,
    title: article.title,
    summary: article.summary,
    body: article.body,
    sourceUrl: article.sourceUrl,
    sourceName: article.sourceName,
    importedArticle: article.importedArticle ?? null,
    recommendation: {
      ...recommendation,
      ...(rejected ? { rejectedAt: new Date().toISOString(), rejectionReason: reason || "其他" } : { rejectedAt: undefined, rejectionReason: undefined }),
    },
  });
}

export async function updatePublicArticle(id: string, input: PublicArticleInput): Promise<PublicArticle> {
  const storedInput = await localizePublicArticleInputCover(input);
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?id=eq.${encodeURIComponent(id)}&published=eq.true`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(articleRowPayload(storedInput, true)),
    },
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Published article was not found.");
  }
  await mergeArticleCaches(row.id, storedInput);
  invalidatePublicRecommendations();
  return getPublicArticle(row.id).then((article) => article ?? mapArticle(row));
}

export async function createPublicArticle(input: PublicArticleInput): Promise<PublicArticle> {
  const storedInput = await localizePublicArticleInputCover(input);
  const duplicate = await findDuplicateArticleRow(storedInput, true);
  if (duplicate) {
    return updatePublicArticle(duplicate.id, storedInput);
  }
  const rows = await supabaseFetch<SupabaseArticleRow[]>("public_articles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(articleRowPayload(storedInput, true)),
  });
  const article = rows[0];
  if (!article) {
    throw new Error("Supabase did not return the created article.");
  }
  await mergeArticleCaches(article.id, storedInput);
  invalidatePublicRecommendations();
  return getPublicArticle(article.id).then((created) => created ?? mapArticle(article));
}

export async function deletePublicArticle(id: string): Promise<void> {
  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  invalidatePublicRecommendations();
}
