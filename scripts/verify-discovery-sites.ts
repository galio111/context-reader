/** Read-only by default. --initialize writes only the new source registry if absent.
 * Enabling sources is a separate Admin action after reviewing these samples. */
import sharp from "sharp";
import { defaultDiscoverySites } from "../lib/discoveryDefaults";
import { readSourceFeed } from "../lib/recommendationFeed";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { safeRemoteFetch, readResponseText, readResponseBytes } from "../lib/safeRemoteFetch";
import { assertCrawlerAllowed } from "../lib/crawlerRobots";
import { hasRecentPublishingCadence, minimumDiscoveryWords } from "../lib/discoveryPolicy";
import type { DiscoverySite } from "../lib/discoveryStore";
async function verify(site: DiscoverySite) {
  const result: NonNullable<DiscoverySite["verification"]> = { at: new Date().toISOString(), ok: false, message: "", samples: [] };
  try {
    const sets = await Promise.all(site.feeds.map((feedUrl) => readSourceFeed({ ...site, feedUrl }, site.topics[0]).catch(() => [])));
    const items = [...new Map(sets.flat().map((item) => [item.url, item])).values()].filter((item) => !item.publishedAt || Date.parse(item.publishedAt) <= Date.now()).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    if (!items.length) throw new Error("订阅或列表暂时无法安全读取，需要复查地址和访问规则。");
    if (!hasRecentPublishingCadence(items.map((item) => item.publishedAt))) throw new Error("最近更新频率未达日更或每 2–3 天更新，留作备选。");
    for (const item of items.slice(0, 6)) {
      if (result.samples.length === 2) break;
      try {
        await assertCrawlerAllowed(item.url);
        const response = await safeRemoteFetch(item.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) continue;
        const extracted = extractImportedArticleFromHtml(await readResponseText(response, 1_200_000), item.url);
        if (!extracted || extracted.metadata.intakeWarnings?.length) continue;
        const words = (extracted.article.text.match(/\b[a-zA-Z]+\b/g) || []).length;
        if (words < minimumDiscoveryWords(site.levelHint)) continue;
        const imageUrl = extracted.metadata.coverCandidates.find((url) => !/logo|avatar|icon|banner|meatball/i.test(url));
        if (!imageUrl) continue;
        const image = await safeRemoteFetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
        if (!image.ok) continue;
        const metadata = await sharp(await readResponseBytes(image, 5_000_000), { limitInputPixels: 40_000_000 }).metadata();
        if ((metadata.width || 0) < 300 || (metadata.height || 0) < 150) continue;
        result.samples.push({ url: item.url, title: extracted.article.title, words, images: extracted.article.blocks.filter((b) => b.type === "image").length || 1, preview: extracted.article.text.slice(0, 500) + "\n[…正文中段省略…]\n" + extracted.article.text.slice(-200) });
      } catch { /* Fail closed and try another public article. */ }
    }
    result.ok = result.samples.length === 2 && site.articleHosts[0] !== "sciencedaily.com";
    result.message = site.articleHosts[0] === "sciencedaily.com" ? "官方 RSS 说明不允许转载完整正文，暂停自动收录。"
      : result.ok ? "近期持续更新，两篇正文和图片可读取；请检查样本后启用。" : "近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。";
  } catch (e) { result.message = String(e).replace(/^Error: /, "").slice(0, 200); }
  return { ...site, verification: result };
}
async function main() {
  if (process.argv.includes("--report")) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const response = await fetch(process.env.SUPABASE_URL! + "/rest/v1/account_settings?key=eq.recommendation_discovery_sites_v2&select=value", { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!response.ok) throw new Error("Cannot read source registry");
    const rows = await response.json() as Array<{ value: DiscoverySite[] }>;
    console.log(JSON.stringify(rows[0]?.value || []));
    return;
  }
  const filter = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const sites = defaultDiscoverySites().filter((site) => !filter.length || filter.includes(site.id));
  let index = 0;
  const verified: DiscoverySite[] = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < sites.length) {
      const result = await verify(sites[index++]);
      verified.push(result);
      console.log(JSON.stringify(result));
    }
  }));
  if (process.argv.includes("--initialize")) {
    if (filter.length) throw new Error("Initialization requires the complete source registry.");
    const base = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const response = await fetch(base + "/rest/v1/account_settings?on_conflict=key", { method: "POST", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([{ key: "recommendation_discovery_sites_v2", value: verified, updated_at: new Date().toISOString() }]) });
    if (!response.ok) throw new Error("Registry initialization failed: " + response.status);
    console.log(JSON.stringify({ initialized: (await response.json()).length === 1, checked: verified.length, passed: verified.filter((s) => s.verification?.ok).length, enabled: 0 }));
  }
  if (process.argv.includes("--merge-verification")) {
    const base = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
    const read = await fetch(base + "/rest/v1/account_settings?key=eq.recommendation_discovery_sites_v2&select=value,updated_at", { headers });
    if (!read.ok) throw new Error("Cannot read source registry");
    const rows = await read.json() as Array<{ value: DiscoverySite[]; updated_at: string }>;
    if (!rows[0]) throw new Error("Initialize source registry first");
    const merged = [...rows[0].value];
    for (const result of verified) {
      const i = merged.findIndex((site) => site.id === result.id);
      if (i < 0) merged.push(result);
      else if (JSON.stringify(merged[i].feeds) === JSON.stringify(result.feeds)) merged[i] = { ...merged[i], verification: result.verification, enabled: result.verification?.ok ? merged[i].enabled : false };
    }
    const response = await fetch(base + "/rest/v1/account_settings?key=eq.recommendation_discovery_sites_v2&updated_at=eq." + encodeURIComponent(rows[0].updated_at), { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ value: merged, updated_at: new Date().toISOString() }) });
    if (!response.ok || (await response.json()).length !== 1) throw new Error("Registry changed concurrently; no overwrite");
    console.log(JSON.stringify({ merged: verified.length, total: merged.length, passed: merged.filter((s) => s.verification?.ok).length }));
  }
}
void main();
