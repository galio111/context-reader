/**
 * Generate a reviewable, idempotent SQL refresh from the public catalogue.
 * Run locally with: node ops/mainland/backfill-cover-previews.mjs <output.sql>
 * The SQL upgrades previews only when the cover URL still matches the snapshot.
 */
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const output = process.argv[2];
if (!output) throw new Error("Provide an output .sql path.");
const response = await fetch("https://context-reader.com/api/public-articles", { cache: "no-store" });
if (!response.ok) throw new Error(`Public catalogue HTTP ${response.status}`);
const { articles } = await response.json();
if (!Array.isArray(articles)) throw new Error("Invalid public catalogue.");
const selected = articles.filter(({ id, recommendation }) =>
  /^[0-9a-f-]{36}$/i.test(id)
  && recommendation?.coverImageUrl?.startsWith("https://context-reader.com/storage/v1/object/public/public-article-covers/")
);
let cursor = 0;
const values = [];
const failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < selected.length) {
    const article = selected[cursor++];
    try {
      let bytes;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const imageResponse = await fetch(article.recommendation.coverImageUrl, { signal: AbortSignal.timeout(45_000) });
          if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`);
          bytes = Buffer.from(await imageResponse.arrayBuffer());
          break;
        } catch (error) {
          if (attempt === 3) throw error;
        }
      }
      if (!bytes) throw new Error("Image download failed");
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Image exceeds 5MB limit");
      const preview = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
        .rotate().resize(256, 192, { fit: "cover", position: "entropy" })
        .webp({ quality: 60, effort: 4 }).toBuffer();
      if (!preview.length || preview.length > 24_000) throw new Error("Preview exceeds 24KB limit");
      values.push([article.id, article.recommendation.coverImageUrl, `data:image/webp;base64,${preview.toString("base64")}`]);
    } catch (error) {
      failures.push({ id: article.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}));
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const sql = [
  "\\set ON_ERROR_STOP on",
  "begin;",
  "set local lock_timeout = '5s';",
  "set local statement_timeout = '120s';",
  "-- Hold the article table briefly while changing only preview metadata; preserve editorial updated_at order.",
  "alter table public.public_articles disable trigger public_articles_set_updated_at;",
  values.length ? `with previews(id, cover_url, preview) as (values\n${values.map(([id, url, preview]) => `  (${literal(id)}::uuid, ${literal(url)}, ${literal(preview)})`).join(",\n")}\n)\nupdate public.public_articles as article\nset imported_article = jsonb_set(article.imported_article, '{recommendation,coverPreviewDataUrl}', to_jsonb(previews.preview), true)\nfrom previews\nwhere article.id = previews.id\n  and article.published = true\n  and article.imported_article #>> '{recommendation,coverImageUrl}' = previews.cover_url\n  and coalesce(article.imported_article #>> '{recommendation,coverPreviewDataUrl}', '') <> previews.preview;` : "select 0 as no_rows_to_backfill;",
  "alter table public.public_articles enable trigger public_articles_set_updated_at;",
  "commit;",
  "select count(*) filter (where coalesce(imported_article #>> '{recommendation,coverImageUrl}', '') <> '') as covers, count(*) filter (where coalesce(imported_article #>> '{recommendation,coverImageUrl}', '') <> '' and coalesce(imported_article #>> '{recommendation,coverPreviewDataUrl}', '') = '') as missing_previews from public.public_articles where published = true;",
  "",
].join("\n");
await writeFile(output, sql, { flag: "wx" });
console.log(JSON.stringify({ catalogue: articles.length, selected: selected.length, generated: values.length, failures, sqlBytes: Buffer.byteLength(sql) }));
if (failures.length) process.exitCode = 1;
