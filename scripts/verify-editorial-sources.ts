/** Read-only publisher probes. Never enables sources or publishes articles. */
import { mkdir, writeFile } from "node:fs/promises";
import { defaultDiscoverySites } from "../lib/discoveryDefaults";
import { readSourceFeed } from "../lib/recommendationFeed";
import { fetchRemoteDocument } from "../lib/overseasFetch";
import { readResponseText } from "../lib/safeRemoteFetch";
import { assertCrawlerAllowed } from "../lib/crawlerRobots";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { discoveryImageIsReadable } from "../lib/discoveryImages";
import { editorialStructureFailures } from "../lib/editorialReviewPolicy";
import { hasRecentPublishingCadence } from "../lib/discoveryPolicy";

async function main() {
  const ids = process.argv.slice(2);
  await mkdir("artifacts/editorial-source-probes", { recursive: true });
  for (const site of defaultDiscoverySites().filter((s) => ids.includes(s.id))) {
    if (process.env.EDITORIAL_PROBE_FEED) { site.feedUrl = process.env.EDITORIAL_PROBE_FEED; site.feeds = [site.feedUrl]; }
    const samples: unknown[] = [];
    try {
      const items = (await readSourceFeed(site, site.topics[0])).filter((i) => !i.publishedAt || Date.parse(i.publishedAt) <= Date.now());
      for (const [index, item] of items.slice(0, 3).entries()) {
        try {
          await assertCrawlerAllowed(item.url);
          const { response } = await fetchRemoteDocument(item.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await readResponseText(response, 1_200_000);
          await writeFile(`artifacts/editorial-source-probes/${site.id}-${index}.html`, html);
          const extracted = extractImportedArticleFromHtml(html, item.url);
          if (!extracted) throw new Error("No extracted article");
          const images = [...new Set(extracted.article.blocks.filter((b) => b.type === "image").map((b) => b.src).filter((s): s is string => !!s))];
          const imageResults = [];
          for (const image of images.slice(0, 20)) imageResults.push({ url: image, ok: await discoveryImageIsReadable(image, item.url) });
          const words = (extracted.article.text.match(/\b[a-zA-Z]+\b/g) || []).length;
          const problems = [...(extracted.metadata.intakeWarnings || []), ...editorialStructureFailures(extracted.article)];
          if (extracted.metadata.completeness?.missingTextBlocks || extracted.metadata.completeness?.missingImages) problems.push("Source comparison detected missing text or images");
          const sample = { url: item.url, title: extracted.article.title, words, images: imageResults, problems, ok: words >= 401 && images.length > 0 && images.length <= 20 && imageResults.every((i) => i.ok) && !problems.length, head: extracted.article.text.slice(0, 350), tail: extracted.article.text.slice(-450) };
          samples.push(sample);
          await writeFile(`artifacts/editorial-source-probes/${site.id}-${index}.json`, JSON.stringify({ ...sample, article: extracted.article }, null, 2));
        } catch (error) { samples.push({ url: item.url, ok: false, error: String(error) }); }
      }
      const result = { id: site.id, cadence: hasRecentPublishingCadence(items.map((i) => i.publishedAt)), samples };
      await writeFile(`artifacts/editorial-source-probes/${site.id}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
    } catch (error) { console.log(JSON.stringify({ id: site.id, error: String(error) })); }
  }
}
void main();
