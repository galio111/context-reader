import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "lib", "publicArticles.ts");
const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
const summaryFunction = source.match(/export async function listPublicArticleSummaries[\s\S]*?\n}\n/)?.[0] ?? "";

if (!summaryFunction) {
  throw new Error("listPublicArticleSummaries was not found");
}
if (/select=[^\n\"]*\bbody\b/.test(summaryFunction) || /select=[^\n\"]*\bimported_article\b(?!->recommendation)/.test(summaryFunction)) {
  throw new Error("homepage summary query includes a full article payload");
}
const cacheSource = fs.readFileSync(path.join(root, "lib", "publicReadCache.ts"), "utf8");
if (!/publicReadCache\.summaries\.get\("catalogue"/.test(summaryFunction) ||
    !/summaries:\s*new BoundedAsyncCache\(300_000,\s*1,\s*16 \* 1024 \* 1024\)/.test(cacheSource)) {
  throw new Error("homepage catalogue requires a bounded five-minute cache large enough for current metadata");
}
if (/next:\s*\{\s*revalidate:/.test(summaryFunction)) {
  throw new Error("catalogue pages must refresh inside one shared load, not parallel per-page revalidation");
}

console.log("static egress guard passed: homepage query excludes bodies and uses a five-minute cache");

if (!process.argv.includes("--live")) {
  process.exit(0);
}

function readEnvFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(
    fs.readFileSync(filename, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['\"]|['\"]$/g, "")]),
  );
}

const fileEnv = readEnvFile(path.join(root, ".env.local"));
const supabaseUrl = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --live");
}

const query = "public_articles?select=id,title,summary,source_url,source_name,recommendation:imported_article->recommendation,created_at,updated_at&published=eq.true&order=updated_at.desc";
const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${query}`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
if (!response.ok) {
  throw new Error(`live summary query failed with HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
}
const bytes = Buffer.byteLength(await response.text());
console.log(`live summary response: ${bytes} bytes`);
if (bytes > 512 * 1024) {
  throw new Error("homepage summary response exceeds the 512 KiB safety ceiling");
}
