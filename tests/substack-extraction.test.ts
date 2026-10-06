import assert from "node:assert/strict";
import { test } from "node:test";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { defaultDiscoverySites } from "../lib/discoveryDefaults";
import { parseFeed, canonicalArticleUrl } from "../lib/recommendationFeed";
import { hasRecentPublishingCadence } from "../lib/discoveryPolicy";
import { rankEditorialSources } from "../lib/editorialSourcePriority";

const title = "A detailed report on technology and business";
const opening = "The opening explains how new technology changes the way people work, with evidence from researchers and independent businesses.";
const ending = "The final paragraph explains the remaining uncertainty and the practical implications of the evidence for readers around the world.";
const prose = `<p>${opening}</p><h3>1. The evidence</h3><p>${"Independent researchers compared the results across several communities and explained their methods. ".repeat(12)}</p>
<figure><a class="image-link image2" data-component-name="Image2ToDOM" href="https://substackcdn.com/chart.jpeg"><picture><img src="https://substackcdn.com/chart.jpeg" width="1272" height="800"></picture></a><figcaption>Survey findings.</figcaption></figure>
<div class="subscribe-widget"><p>Subscribe for updates from this publication.</p></div><div class="post-embed"><p>Unrelated recommended story.</p></div>
<div data-component-name="DigestPostEmbed" class="digestPostEmbed-changingHash"><div><span>Unrelated author · Oct 2</span></div><div><a href="/p/another-post"><span>Read full story</span></a></div></div>
<div class="newsletter-signup"><p>Newsletter signup promotion.</p></div><div hidden><p>Hidden article bait must stay excluded.</p></div>
<h3>2. The conclusion</h3><p>${ending}</p>`;
const shell = '<section id="discussion"><h4>Discussion about this post</h4><p>No posts</p><p>A long reader comment must never become the article body when the real body is missing from the page.</p></section><h3>Ready for more?</h3>';
function html(content = prose, attributes = "", outer = "") {
  return `<html lang="en"><head><title>${title}</title><meta property="og:image" content="https://substackcdn.com/cover.jpeg"><script type="application/ld+json">{"datePublished":"2026-10-05T14:00:00Z"}</script></head><body><div ${outer}><article class="typography newsletter-post post"><header><h1>${title}</h1></header><div class="dt-post-body"><div class="available-content" ${attributes}><div class="body markup">${content}</div></div></div><aside class="paywall"><p>Subscribe to continue reading.</p></aside></article></div>${shell}</body></html>`;
}
for (const host of ["www.a16z.news", "example.substack.com", "newsletter.example.org"]) test(`Substack body survives newsletter filtering on ${host}`, () => {
  const result = extractImportedArticleFromHtml(html(), `https://${host}/p/report`);
  assert.ok(result);
  assert.ok(result.article.text.includes(opening) && result.article.text.includes(ending));
  assert.equal(result.article.blocks.filter(b => b.type === "image").length, 1);
  assert.match(result.article.text, /Survey findings/);
  assert.doesNotMatch(result.article.text, /Discussion|No posts|Ready for more|reader comment|Subscribe|Unrelated|Read full story|signup|Hidden article bait/);
  assert.equal(result.article.publishedTime, "2026-10-05T14:00:00Z");
  assert.deepEqual(result.metadata.completeness, { referenceKind: "article-body", missingTextBlocks: 0, missingImages: 0 });
});
test("missing, empty, paywalled or hidden public bodies fail instead of importing footer chrome", () => {
  const variants = [html(""), html().replace('class="body markup"', 'class="changed-template"'),
    ...["hidden", 'style="display:none"', 'aria-hidden="true"', 'class="paywall"'].map(attr => html(prose, "", attr)),
    html(prose, "hidden")];
  for (const source of variants) assert.equal(extractImportedArticleFromHtml(source, "https://www.a16z.news/p/report"), null);
});
test("public preview does not expose hidden subscriber text or remove subscription warnings", () => {
  const source = html(prose + '<div class="paywall"><p>Subscriber-only text.</p></div>').replace('"datePublished":', '"isAccessibleForFree":false,"datePublished":');
  const result = extractImportedArticleFromHtml(source, "https://newsletter.example.org/p/report");
  assert.ok(result);
  assert.doesNotMatch(result.article.text, /Subscriber-only/);
  assert.ok(result.metadata.intakeWarnings?.includes("页面标记正文需要订阅"));
});
test("a16z paired terminal disclaimer removal preserves in-article quotations and other hosts", () => {
  const footer = '<p><em>This newsletter is provided for informational purposes only, and includes publisher disclosures. Visit <a href="https://a16z.com/investment-list/">investment list</a> and <a href="http://a16z.com/disclosures">disclosures</a>.</em></p>';
  const result = extractImportedArticleFromHtml(html(prose + footer), "https://www.a16z.news/p/report");
  assert.ok(result?.article.text.endsWith(ending));
  assert.match(extractImportedArticleFromHtml(html(prose + footer), "https://other.substack.com/p/report")!.article.text, /publisher disclosures/);
  assert.match(extractImportedArticleFromHtml(html(footer + prose), "https://www.a16z.news/p/report")!.article.text, /publisher disclosures/);
});
test("a16z feed discovery picks up later entries, canonicalizes tracking and stays disabled before verification", () => {
  const site = defaultDiscoverySites().find(s => s.id === "a16z-news")!;
  assert.ok(site); assert.equal(site.enabled, false); assert.equal(site.discovery, "feed");
  const item = (slug: string, date: string) => `<item><title>Business research ${slug}</title><link>https://www.a16z.news/p/${slug}?utm_source=email</link><pubDate>${date}</pubDate></item>`;
  const first = parseFeed(`<rss><channel>${item("earlier", "2026-10-02T14:00Z")}</channel></rss>`, site, "商业经济");
  const later = parseFeed(`<rss><channel>${item("new", "2026-10-05T14:00Z")}${item("earlier", "2026-10-02T14:00Z")}<item><title>External story</title><link>https://elsewhere.example/p/story</link></item></channel></rss>`, site, "商业经济");
  const known = new Set(first.map(i => canonicalArticleUrl(i.url)));
  assert.deepEqual(later.filter(i => !known.has(i.url)).map(i => i.url), ["https://www.a16z.news/p/new"]);
  assert.equal(hasRecentPublishingCadence(later.map(i => i.publishedAt), Date.parse("2026-10-06T02:00Z")), true);
  const counts = { "商业": 0, "时事": 13, "科技": 13, "文化": 13 };
  assert.equal(rankEditorialSources([site], counts, {}).length, 0);
  assert.equal(rankEditorialSources([{ ...site, enabled: true, verification: { at: "", ok: true, message: "", samples: [] } }], counts, {}).length, 1);
  assert.equal(rankEditorialSources([{ ...site, enabled: true, verification: { at: "", ok: true, message: "", samples: [] } }], counts, { [site.id]: { visits: 2, empty: 2 } }).length, 0, "Substack is not a WordPress paged feed; stop after two empty batches");
});
