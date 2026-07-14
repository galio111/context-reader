import type { ImportedArticle } from "@/types/article";
import type { PublicArticle, PublicArticleInput, PublicArticleTranslation, PublicExplanation } from "@/types/publicArticle";

interface SupabaseArticleRow {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source_url: string | null;
  source_name: string | null;
  imported_article: ImportedArticle | null;
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
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
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

function mapArticle(
  row: SupabaseArticleRow,
  explanations: PublicExplanation[] = [],
  articleTranslations: PublicArticleTranslation[] = [],
): PublicArticle {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body ?? "",
    sourceUrl: row.source_url ?? "",
    sourceName: row.source_name ?? "",
    ...(row.imported_article ? { importedArticle: row.imported_article } : {}),
    explanations,
    articleTranslations,
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

async function insertPublicExplanations(articleId: string, explanations: PublicExplanation[]): Promise<void> {
  const validExplanations = explanations.filter(
    (item) => item.cacheKey && item.word.trim() && item.sentence.trim() && item.explanation,
  );

  if (validExplanations.length === 0) {
    return;
  }

  await supabaseFetch("public_explanations", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(
      validExplanations.map((item) => ({
        article_id: articleId,
        cache_key: item.cacheKey,
        word: item.word.trim(),
        sentence: item.sentence.trim(),
        explanation: item.explanation,
      })),
    ),
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
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(
      validArticleTranslations.map((item) => ({
        article_id: articleId,
        cache_key: item.cacheKey,
        translations: item.translations,
      })),
    ),
  });
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

async function findDuplicatePublicArticle(input: PublicArticleInput): Promise<PublicArticle | null> {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const sourceUrl = input.sourceUrl?.trim() || input.importedArticle?.url || "";
  const sourceFilter = sourceUrl ? `&source_url=eq.${encodeFilter(sourceUrl)}` : "";
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,created_at,updated_at&published=eq.true&title=eq.${encodeFilter(title)}&summary=eq.${encodeFilter(summary)}${sourceFilter}&limit=1`,
  );
  const duplicate = rows[0];
  if (!duplicate) {
    return null;
  }

  await insertPublicExplanations(duplicate.id, input.explanations ?? []);
  await insertPublicArticleTranslations(duplicate.id, input.articleTranslations ?? []);
  return getPublicArticle(duplicate.id);
}

export async function listPublicArticles(): Promise<PublicArticle[]> {
  const rows = await supabaseFetch<SupabaseArticleRow[]>(
    "public_articles?select=id,title,summary,source_url,source_name,created_at,updated_at&published=eq.true&order=updated_at.desc",
  );
  return rows.map((row) => mapArticle(row));
}

export async function getPublicArticle(id: string): Promise<PublicArticle | null> {
  const articleRows = await supabaseFetch<SupabaseArticleRow[]>(
    `public_articles?select=id,title,summary,body,source_url,source_name,imported_article,created_at,updated_at&id=eq.${encodeURIComponent(id)}&published=eq.true&limit=1`,
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

export async function createPublicArticle(input: PublicArticleInput): Promise<PublicArticle> {
  const duplicate = await findDuplicatePublicArticle(input);
  if (duplicate) {
    return duplicate;
  }

  const articleRows = await supabaseFetch<SupabaseArticleRow[]>("public_articles", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      title: input.title.trim(),
      summary: input.summary.trim(),
      body: input.body.trim(),
      source_url: input.sourceUrl?.trim() || input.importedArticle?.url || "",
      source_name: input.sourceName?.trim() || input.importedArticle?.siteName || "",
      imported_article: input.importedArticle ?? null,
      published: true,
    }),
  });

  const article = articleRows[0];
  if (!article) {
    throw new Error("Supabase did not return the created article.");
  }

  await insertPublicExplanations(article.id, input.explanations ?? []);
  await insertPublicArticleTranslations(article.id, input.articleTranslations ?? []);

  return getPublicArticle(article.id).then((created) => created ?? mapArticle(article));
}

export async function deletePublicArticle(id: string): Promise<void> {
  await supabaseFetch(`public_articles?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });
}
