import { defaultDiscoverySites } from "../lib/discoveryDefaults";
import { readSourceFeed } from "../lib/recommendationFeed";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { readResponseText, safeRemoteFetch } from "../lib/safeRemoteFetch";
import { assertCrawlerAllowed } from "../lib/crawlerRobots";

async function main() {
  const filter = process.argv.slice(2);
  for (const site of defaultDiscoverySites().filter((s) => !filter.length || filter.includes(s.id))) {
    const samples: unknown[] = [];
    let count = 0;
    let dates: string[] = [];
    try {
      const feeds = await Promise.all(site.feeds.map(async (feedUrl) => {
        try { return await readSourceFeed({ ...site, feedUrl }, site.topics[0]); } catch { return []; }
      }));
      const items = [...new Map(feeds.flat().map((item) => [item.url, item])).values()]
        .filter((item) => !item.publishedAt || Date.parse(item.publishedAt) <= Date.now())
        .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      count = items.length;
      dates = items.slice(0, 10).map((item) => item.publishedAt);
      for (const item of items.slice(0, 3)) {
        try {
          await assertCrawlerAllowed(item.url);
          const response = await safeRemoteFetch(item.url, { signal: AbortSignal.timeout(15_000) });
          const html = await readResponseText(response, 1_200_000);
          const extracted = extractImportedArticleFromHtml(html, item.url);
          samples.push({ url: item.url, status: response.status, title: extracted?.article.title, words: extracted?.article.text.split(/\s+/).length, date: extracted?.article.publishedTime, images: extracted?.article.blocks.filter((b) => b.type === "image").length, covers: extracted?.metadata.coverCandidates.slice(0, 2), preview: extracted?.article.text.slice(0, 350), tail: extracted?.article.text.slice(-220) });
        } catch (e) { samples.push({ url: item.url, error: String(e) }); }
      }
    } catch (e) { samples.push({ error: String(e) }); }
    console.log(JSON.stringify({ id: site.id, count, dates, samples }));
  }
}
void main();
