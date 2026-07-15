import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";
import type {
  ArticleRecommendationMetadata,
  PublicArticle,
  PublicArticleCandidateInput,
  PublicArticleInput,
  PublicArticleTranslation,
  PublicExplanation,
} from "@/types/publicArticle";

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

function supabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
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

function recommendationFromRow(row: SupabaseArticleRow): ArticleRecommendationMetadata | undefined {
  return row.recommendation ?? row.imported_article?.recommendation ?? undefined;
}

function mapArticle(
  row: SupabaseArticleRow,
  explanations: PublicExplanation[] = [],
  articleTranslations: PublicArticleTranslation[] = [],
): PublicArticle {
  const recommendation = recommendationFromRow(row);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body ?? "",
    sourceUrl: row.source_url ?? "",
    sourceName: row.source_name ?? "",
    ...(row.imported_article ? { importedArticle: row.imported_article } : {}),
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
  if (input.importedArticle) {
    return {
      ...input.importedArticle,
      title: input.title.trim(),
      url: sourceUrl,
      siteName: sourceName,
      text: input.body,
      ...(input.recommendation ? { recommendation: input.recommendation } : {}),
    };
  }
  return {
    title: input.title.trim(),
    url: sourceUrl,
    siteName: sourceName,
    text: input.body,
    blocks: plainTextBlocks(input.title, input.body),
    ...(input.recommendation ? { recommendation: input.recommendation } : {}),
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

async function listPublicExplanations(articleId: string): Promise<PublicExplanation[]> {
  const rows = await supabaseFetch<SupabaseExplanationRow[]>(
    `public_explanations?select=id,article_id,cache_key,word,sentence,explanation&article_id=eq.${encodeURIComponent(articleId)}&order=created_at.asc`,
  );
  return rows.map(mapExplanation);
}

async function findDuplicateArticleRow(input: PublicArticleInput, published: boolean): Promise<SupabaseArticleRow | null> {
  const sourceUrl = input.sourceUrl?.trim() || input.importedArticle?.url || "";
  const identityFilter = sourceUrl
    ? `source_url=eq.${encodeFilter(sourceUrl)}`
    : `title=eq.${encodeFilter(input.title)}&summary=eq.${encodeFilter(input.summary)}`;
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&published=eq.${published}&${identityFilter}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function listPublicArticles(): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    "public_articles?select=id,title,summary,source_url,source_name,recommendation:imported_article->recommendation,created_at,updated_at&published=eq.true&order=updated_at.desc",
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

export async function listArticleCandidates(): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    "public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&published=eq.false&order=updated_at.desc",
  );
  return rows.map((row) => mapArticle(row));
}

export async function saveArticleCandidate(input: PublicArticleCandidateInput): Promise<PublicArticle> {
  let existing: SupabaseArticleRow | null = null;
  if (input.id) {
    const rows = await supabaseFetch<SupabaseArticleRow[]>(
      `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,published,created_at,updated_at&id=eq.${encodeURIComponent(input.id)}&published=eq.false&limit=1`,
    );
    existing = rows[0] ?? null;
  } else {
    existing = await findDuplicateArticleRow(input, false);
  }

  let row: SupabaseArticleRow | undefined;
  if (existing) {
    const rows = await supabaseFetch<SupabaseArticleRow[]>(
      `public_articles?id=eq.${encodeURIComponent(existing.id)}&published=eq.false`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(articleRowPayload(input, false)),
      },
    );
    row = rows[0];
  } else {
    const rows = await supabaseFetch<SupabaseArticleRow[]>("public_articles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(articleRowPayload(input, false)),
    });
    row = rows[0];
  }
  if (!row) {
    throw new Error("Supabase did not return the saved article candidate.");
  }
  await mergeArticleCaches(row.id, input);
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
  if (!candidate.imported_article?.recommendation?.coverImageUrl?.trim()) {
    throw new Error("推荐封面缺失，补充封面后才能发布。");
  }

  const candidateInput: PublicArticleInput = {
    title: candidate.title,
    summary: candidate.summary,
    body: candidate.body ?? candidate.imported_article.text,
    sourceUrl: candidate.source_url ?? "",
    sourceName: candidate.source_name ?? "",
    importedArticle: candidate.imported_article,
    recommendation: candidate.imported_article.recommendation,
  };
  const duplicate = await findDuplicateArticleRow(candidateInput, true);
  if (duplicate && duplicate.id !== candidate.id) {
    const [explanations, articleTranslations] = await Promise.all([
      listPublicExplanations(candidate.id),
      listPublicArticleTranslations(candidate.id),
    ]);
    const updated = await updatePublicArticle(duplicate.id, {
      ...candidateInput,
      explanations,
      articleTranslations,
    });
    await deleteArticleCandidate(candidate.id);
    return updated;
  }

  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}&published=eq.false`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ published: true }),
  });
  const article = await getPublicArticle(id);
  if (!article) {
    throw new Error("Candidate was published but could not be reloaded.");
  }
  return article;
}

export async function deleteArticleCandidate(id: string): Promise<void> {
  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}&published=eq.false`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function updatePublicArticle(id: string, input: PublicArticleInput): Promise<PublicArticle> {
  if (!(input.recommendation?.coverImageUrl || input.importedArticle?.recommendation?.coverImageUrl || "").trim()) {
    throw new Error("推荐封面缺失，补充封面后才能更新公开文章。");
  }
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?id=eq.${encodeURIComponent(id)}&published=eq.true`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(articleRowPayload(input, true)),
    },
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Published article was not found.");
  }
  await mergeArticleCaches(row.id, input);
  return getPublicArticle(row.id).then((article) => article ?? mapArticle(row));
}

export async function createPublicArticle(input: PublicArticleInput): Promise<PublicArticle> {
  const duplicate = await findDuplicateArticleRow(input, true);
  if (duplicate) {
    return updatePublicArticle(duplicate.id, input);
  }
  if (!(input.recommendation?.coverImageUrl || input.importedArticle?.recommendation?.coverImageUrl || "").trim()) {
    throw new Error("推荐封面缺失，补充封面后才能发布。");
  }
  const rows = await supabaseFetch<SupabaseArticleRow[]>("public_articles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(articleRowPayload(input, true)),
  });
  const article = rows[0];
  if (!article) {
    throw new Error("Supabase did not return the created article.");
  }
  await mergeArticleCaches(article.id, input);
  return getPublicArticle(article.id).then((created) => created ?? mapArticle(article));
}

export async function deletePublicArticle(id: string): Promise<void> {
  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}
