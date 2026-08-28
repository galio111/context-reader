import { createHmac, timingSafeEqual } from "crypto";
import { isExternalArticleImageUrl } from "@/lib/articleImageUrls";
import type { ImportedArticle } from "@/types/article";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 15 * 60 * 1_000;

interface ImageLocalizationTokenPayload {
  version: number;
  expiresAt: number;
  articleUrl: string;
  imageSources: string[];
}

function tokenSecret(): string {
  return process.env.URL_IMPORT_TOKEN_SECRET?.trim()
    || process.env.ADMIN_SESSION_SECRET?.trim()
    || "";
}

function externalImageSources(article: ImportedArticle): string[] {
  return Array.from(new Set(
    article.blocks
      .filter((block) => block.type === "image" && block.src && isExternalArticleImageUrl(block.src))
      .map((block) => block.src as string),
  )).sort();
}

function sign(encodedPayload: string): string {
  const secret = tokenSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createUrlImportImageToken(article: ImportedArticle): string {
  const imageSources = externalImageSources(article);
  if (!tokenSecret() || imageSources.length === 0) return "";
  const payload: ImageLocalizationTokenPayload = {
    version: TOKEN_VERSION,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    articleUrl: article.url,
    imageSources,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyUrlImportImageToken(article: ImportedArticle, token: string): boolean {
  if (!tokenSecret() || !token) return false;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra || !signaturesMatch(sign(encodedPayload), signature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ImageLocalizationTokenPayload;
    return payload.version === TOKEN_VERSION
      && Number.isFinite(payload.expiresAt)
      && payload.expiresAt >= Date.now()
      && payload.expiresAt <= Date.now() + TOKEN_TTL_MS
      && payload.articleUrl === article.url
      && JSON.stringify(payload.imageSources) === JSON.stringify(externalImageSources(article));
  } catch {
    return false;
  }
}
