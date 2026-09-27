import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { generateCoverVariants } from "../lib/coverVariants.mjs";

// Dry-run by default. Run inside the accepted app container, whose credentials
// never leave it. Resume with the printed UUID; uploads are content-addressed.
const args = process.argv.slice(2);
const value = (name, fallback) => args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const apply = args.includes("--apply");
const analyze = args.includes("--analyze");
const limit = Number(value("--limit", "10"));
const after = value("--after", "");
if (!Number.isInteger(limit) || limit < 1 || limit > 25 || (after && !/^[a-f0-9-]{36}$/.test(after))) throw new Error("Invalid bounded batch");
const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const publicBase = process.env.SUPABASE_PUBLIC_URL?.replace(/\/$/, "") || base;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Run with the active mainland app environment");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const bucket = "public-article-covers";
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`Storage/database HTTP ${response.status}`);
  return response;
}
const rows = await (await request(`/rest/v1/public_articles?select=id,updated_at,imported_article&published=eq.true&order=id.asc&limit=${limit}${after ? `&id=gt.${after}` : ""}`)).json();
const backupDir = resolve(value("--backup-dir", "/tmp/context-reader-cover-variants"));
if (apply) await mkdir(backupDir, { recursive: true, mode: 0o700 });
for (const row of rows) {
  const recommendation = row.imported_article?.recommendation;
  const sourceUrl = recommendation?.coverImageUrl;
  if (!sourceUrl || recommendation.coverVariants?.sourceUrl === sourceUrl && recommendation.coverVariants?.version === 1) {
    console.log(JSON.stringify({ id: row.id, status: "already-ready-or-no-photo" })); continue;
  }
  const url = new URL(sourceUrl);
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!url.pathname.startsWith(prefix) || url.origin !== new URL(publicBase).origin) throw new Error(`Noncanonical source ${row.id}`);
  if (!apply && !analyze) { console.log(JSON.stringify({ id: row.id, status: "planned", sourceUrl })); continue; }
  const bytes = new Uint8Array(await (await request(`/storage/v1/object/${bucket}/${url.pathname.slice(prefix.length)}`)).arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Error(`Oversize source ${row.id}`);
  const generated = await generateCoverVariants(bytes);
  const items = [];
  const hashes = [];
  for (const item of generated.items) {
    const hash = createHash("sha256").update(item.bytes).digest("hex");
    const path = `variants/v1/${hash.slice(0, 2)}/${hash}.webp`;
    hashes.push({ hash, bytes: item.bytes.length, width: item.width, height: item.height });
    if (apply) {
    const response = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
      method: "POST", headers: { ...headers, "Content-Type": "image/webp", "Cache-Control": "max-age=31536000", "x-upsert": "false" },
      body: item.bytes, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && !/already exists|duplicate|resource exists/i.test(await response.text())) throw new Error(`Upload HTTP ${response.status}`);
    }
    items.push({ url: `${publicBase}/storage/v1/object/public/${bucket}/${path}`, width: item.width, height: item.height });
  }
  items.push({ url: sourceUrl, width: generated.width, height: generated.height });
  if (!apply) {
    console.log(JSON.stringify({ id: row.id, status: "analyzed-no-writes", sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceBytes: bytes.length, variants: hashes }));
    continue;
  }
  // The production timestamp trigger would reorder the catalogue on REST PATCH.
  // Stage a small, reviewable SQL transaction instead; no DB mutation in this script.
  await appendFile(resolve(backupDir, "before.jsonl"), JSON.stringify(row) + "\n", { mode: 0o600 });
  const variants = { version: 1, sourceUrl, width: generated.width, height: generated.height, items };
  const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
  const condition = `id=${literal(row.id)}::uuid AND updated_at=${literal(row.updated_at)}::timestamptz`;
  const transaction = update => `BEGIN;\nSET LOCAL lock_timeout='3s';\nLOCK TABLE public.public_articles IN SHARE ROW EXCLUSIVE MODE;\nALTER TABLE public.public_articles DISABLE TRIGGER public_articles_set_updated_at;\n${update};\nALTER TABLE public.public_articles ENABLE TRIGGER public_articles_set_updated_at;\nCOMMIT;\n`;
  const json = literal(JSON.stringify(variants)) + "::jsonb";
  const sql = transaction(`UPDATE public.public_articles SET imported_article=jsonb_set(imported_article, '{recommendation,coverVariants}', ${json}) WHERE ${condition} RETURNING id`);
  const old = recommendation.coverVariants;
  const restore = old ? `jsonb_set(imported_article, '{recommendation,coverVariants}', ${literal(JSON.stringify(old))}::jsonb)` : "imported_article #- '{recommendation,coverVariants}'";
  const rollback = transaction(`UPDATE public.public_articles SET imported_article=${restore} WHERE ${condition} AND imported_article#>'{recommendation,coverVariants}'=${json} RETURNING id`);
  await appendFile(resolve(backupDir, "apply.sql"), sql, { mode: 0o600 });
  await appendFile(resolve(backupDir, "rollback.sql"), rollback, { mode: 0o600 });
  const status = "uploaded-sql-staged-not-applied";
  await appendFile(resolve(backupDir, "progress.jsonl"), JSON.stringify({ id: row.id, status, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ id: row.id, status, variants: items.length }));
}
console.log(JSON.stringify({ apply, rows: rows.length, nextAfter: rows.at(-1)?.id || after, complete: rows.length < limit }));
