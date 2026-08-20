import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import sharp from "sharp";
import { readResponseBytes, safeRemoteFetch } from "@/lib/safeRemoteFetch";
import type { ImportedArticle } from "@/types/article";
import type { PublicArticleInput } from "@/types/publicArticle";

export const PUBLIC_COVER_BUCKET = "public-article-covers";
export const PUBLIC_COVER_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const PUBLIC_COVER_ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const MAX_REMOTE_COVER_BYTES = 25 * 1024 * 1024;
const STORED_COVER_PATH = `/storage/v1/object/public/${PUBLIC_COVER_BUCKET}/`;

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("Supabase 存储尚未配置。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function publicStorageUrl(internalUrl: string): string {
  const internalBase = process.env.SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  const publicBase = process.env.SUPABASE_PUBLIC_URL?.trim().replace(/\/$/, "") || "";
  if (!internalBase || !publicBase || !internalUrl.startsWith(internalBase)) return internalUrl;
  return `${publicBase}${internalUrl.slice(internalBase.length)}`;
}

async function ensureCoverBucket(client: ReturnType<typeof supabaseAdmin>) {
  const { data } = await client.storage.getBucket(PUBLIC_COVER_BUCKET);
  if (data) return;
  const { error } = await client.storage.createBucket(PUBLIC_COVER_BUCKET, {
    public: true,
    fileSizeLimit: PUBLIC_COVER_MAX_UPLOAD_BYTES,
    allowedMimeTypes: [...PUBLIC_COVER_ALLOWED_TYPES.keys()],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function uploadCoverBytes(
  bytes: Uint8Array,
  contentType: string,
  extension: string,
  objectPath?: string,
): Promise<string> {
  const client = supabaseAdmin();
  await ensureCoverBucket(client);
  const date = new Date().toISOString().slice(0, 10);
  const path = objectPath || `${date}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(PUBLIC_COVER_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error && !/(already exists|duplicate|resource exists)/i.test(error.message)) throw error;
  const { data } = client.storage.from(PUBLIC_COVER_BUCKET).getPublicUrl(path);
  return publicStorageUrl(data.publicUrl);
}

export async function storeUploadedPublicCover(file: File): Promise<string> {
  const extension = PUBLIC_COVER_ALLOWED_TYPES.get(file.type);
  if (!extension || file.size <= 0 || file.size > PUBLIC_COVER_MAX_UPLOAD_BYTES) {
    throw new Error("仅支持 5MB 以内的 JPG、PNG、WebP 或 AVIF 图片。");
  }
  return uploadCoverBytes(new Uint8Array(await file.arrayBuffer()), file.type, extension);
}

export function isStoredPublicCoverUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    return new URL(value).pathname.startsWith(STORED_COVER_PATH);
  } catch {
    return false;
  }
}

function sourceImageUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname.toLowerCase().endsWith(".brightspotcdn.com")) {
    const nested = url.searchParams.get("url");
    if (nested) {
      const nestedUrl = new URL(nested);
      if (nestedUrl.protocol === "http:") nestedUrl.protocol = "https:";
      return nestedUrl.toString();
    }
  }
  return url.toString();
}

function safeReferer(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function storeRemotePublicCover(value: string, sourceUrl = ""): Promise<string> {
  if (isStoredPublicCoverUrl(value)) return value;

  const referer = safeReferer(sourceUrl);
  const response = await safeRemoteFetch(sourceImageUrl(value), {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; ContextReaderCoverImporter/1.0)",
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(240_000),
  }, { maxRedirects: 4 });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`远程封面读取失败（HTTP ${response.status}）。`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!contentType.startsWith("image/")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("远程封面返回的不是图片。");
  }

  const input = await readResponseBytes(response, MAX_REMOTE_COVER_BYTES);
  const output = await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: 1280, height: 800, fit: "cover", position: "entropy", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  if (!output.length || output.length > PUBLIC_COVER_MAX_UPLOAD_BYTES) {
    throw new Error("封面压缩后仍超过 5MB。");
  }
  const hash = createHash("sha256").update(output).digest("hex");
  return uploadCoverBytes(output, "image/webp", "webp", `external/${hash.slice(0, 2)}/${hash}.webp`);
}

export async function localizePublicArticleInputCover<T extends PublicArticleInput>(input: T): Promise<T> {
  const recommendation = input.recommendation ?? input.importedArticle?.recommendation;
  const coverImageUrl = recommendation?.coverImageUrl?.trim() || "";
  if (!recommendation || !coverImageUrl || isStoredPublicCoverUrl(coverImageUrl)) return input;
  const storedUrl = await storeRemotePublicCover(
    coverImageUrl,
    recommendation.coverImageSourceUrl || input.sourceUrl || input.importedArticle?.url || "",
  );
  const storedRecommendation = { ...recommendation, coverImageUrl: storedUrl };
  return {
    ...input,
    recommendation: storedRecommendation,
    ...(input.importedArticle
      ? { importedArticle: { ...input.importedArticle, recommendation: storedRecommendation } }
      : {}),
  };
}

interface RepairableArticleRow {
  id: string;
  title: string;
  source_url: string | null;
  imported_article: ImportedArticle | null;
}

function supabaseRestConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("Supabase 数据服务尚未配置。");
  return { url, key };
}

async function restRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = supabaseRestConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`封面数据更新失败（HTTP ${response.status}）。`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function repairExternalPublicArticleCovers(ids?: string[]) {
  const idFilter = ids?.length ? `&id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})` : "";
  const rows = await restRequest<RepairableArticleRow[]>(
    `public_articles?select=id,title,source_url,imported_article&published=eq.true${idFilter}&order=updated_at.desc&limit=100`,
  );
  const result = {
    scanned: rows.length,
    updated: [] as Array<{ id: string; title: string; url: string }>,
    skipped: 0,
    failed: [] as Array<{ id: string; title: string; error: string }>,
  };
  for (const row of rows) {
    const recommendation = row.imported_article?.recommendation;
    const coverImageUrl = recommendation?.coverImageUrl?.trim() || "";
    if (!row.imported_article || !recommendation || !coverImageUrl || isStoredPublicCoverUrl(coverImageUrl)) {
      result.skipped += 1;
      continue;
    }
    try {
      const storedUrl = await storeRemotePublicCover(
        coverImageUrl,
        recommendation.coverImageSourceUrl || row.source_url || row.imported_article.url,
      );
      const importedArticle = {
        ...row.imported_article,
        recommendation: { ...recommendation, coverImageUrl: storedUrl },
      };
      await restRequest(`public_articles?id=eq.${encodeURIComponent(row.id)}&published=eq.true`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ imported_article: importedArticle }),
      });
      result.updated.push({ id: row.id, title: row.title, url: storedUrl });
    } catch (error) {
      result.failed.push({
        id: row.id,
        title: row.title,
        error: error instanceof Error ? error.message : "封面修复失败。",
      });
    }
  }
  if (result.updated.length) revalidateTag("public-article-summaries");
  return result;
}
