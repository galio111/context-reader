import test from "node:test";
import assert from "node:assert/strict";
import { atlanticArticleFromFeed } from "../lib/atlanticFeedArticle";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";

const url = "https://www.theatlantic.com/ideas/2026/10/example/689137/";
const prose = Array.from({ length: 55 }, (_, i) => `<p>Observation ${i} explains how people discover useful evidence through careful reading and discussion.</p>`).join("");
const feed = (body = prose, href = url) => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><entry><title>Research &amp; reading</title><link href="${href}"/><content type="html"><![CDATA[${body}]]></content><media:content url="https://cdn.theatlantic.com/example.jpg"/></entry></feed>`;

test("matches canonical publisher article and retains full public feed body through normal extraction", () => {
  const html = atlanticArticleFromFeed(feed(), url + "?utm_source=feed");
  assert.ok(html);
  const result = extractImportedArticleFromHtml(html, url);
  assert.ok(result?.article.text.includes("Observation 54"));
  assert.ok(result?.metadata.coverCandidates?.includes("https://cdn.theatlantic.com/example.jpg"));
  assert.equal(result?.metadata.completeness?.missingTextBlocks, 0);
});
test("does not substitute a different article, foreign domain, short summary or explicit teaser", () => {
  assert.equal(atlanticArticleFromFeed(feed(), url.replace("689137", "689138")), null);
  assert.equal(atlanticArticleFromFeed(feed(), url.replace("www.theatlantic.com", "evil.example")), null);
  assert.equal(atlanticArticleFromFeed(feed("<p>Short summary.</p>"), url), null);
  assert.equal(atlanticArticleFromFeed(feed(prose + "<p>Subscribe to continue reading</p>"), url), null);
  assert.equal(atlanticArticleFromFeed("<broken", url), null);
});
test("removes active markup without losing prose", () => {
  const html = atlanticArticleFromFeed(feed(prose + '<script>alert(1)</script><iframe src="https://example.com"/>'), url)!;
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<iframe"));
  assert.ok(html.includes("Observation 54"));
});
