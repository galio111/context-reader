import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { candidateOrder, freshnessFailure, hasRecentPublishingCadence, minimumDiscoveryWords, shanghaiDay, similarArticle } from "../lib/discoveryPolicy";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { defaultDiscoverySites } from "../lib/discoveryDefaults";
import { applyPublisherProfile } from "../lib/publisherExtractionProfiles";
import type { PublicArticle } from "../types/publicArticle";
const now = Date.parse("2026-09-05T04:00:00Z");
test("Shanghai boundary and invalid timestamp", () => {
  assert.equal(shanghaiDay("2026-09-04T15:59:59Z"), "2026-09-04");
  assert.equal(shanghaiDay("2026-09-04T16:00:00Z"), "2026-09-05");
  assert.equal(shanghaiDay("invalid"), "");
});
test("shuffle keeps today first in chronological order; yesterday participates after midnight", () => {
  const a = (id: string, createdAt: string) => ({ id, createdAt } as PublicArticle);
  const articles = [a("old1", "2026-09-01T00:00Z"), a("today1", "2026-09-04T16:00Z"), a("old2", "2026-09-03T00:00Z"), a("today2", "2026-09-05T02:00Z")];
  const order = ["old2", "today1", "old1", "today2"];
  assert.deepEqual(candidateOrder(articles, order, now).map((a) => a.id), ["today2", "today1", "old2", "old1"]);
  assert.deepEqual(candidateOrder(articles, order, now + 86400_000).map((a) => a.id), order);
  assert.deepEqual(articles.map((a) => a.id), ["old1", "today1", "old2", "today2"]);
});
test("news rejects missing, old and future dates; update cannot hide old publication", () => {
  assert.ok(freshnessFailure([], true, now));
  assert.ok(freshnessFailure(["2026-08-01", "2026-09-04"], true, now));
  assert.ok(freshnessFailure(["2026-09-07"], false, now));
  assert.equal(freshnessFailure(["2024-01-01"], false, now), "");
  assert.equal(freshnessFailure(["2026-09-03"], true, now), "");
});
test("cadence distinguishes daily and 2–3 day publishers from stale or sparse sources", () => {
  assert.equal(hasRecentPublishingCadence(["2026-09-04", "2026-09-03"], now), true);
  assert.equal(hasRecentPublishingCadence(["2026-09-04", "2026-09-01", "2026-08-29"], now), true);
  assert.equal(hasRecentPublishingCadence(["2026-09-04", "2026-08-28"], now), false);
  assert.equal(hasRecentPublishingCadence(["2026-08-01"], now), false);
  assert.equal(hasRecentPublishingCadence(["2026-09-07"], now), false);
});
test("default quota groups multiple feeds from one website", () => {
  const sites = defaultDiscoverySites();
  assert.equal(new Set(sites.map((s) => s.articleHosts[0])).size, sites.length);
  assert.equal(sites.find((s) => s.articleHosts[0] === "npr.org")?.dailyTarget, 2);
  assert.ok(sites.find((s) => s.articleHosts[0] === "npr.org")!.feeds.length > 1);
  assert.ok(sites.every((s) => !s.enabled), "unverified defaults must never silently start collecting");
});
test("every automatic candidate must contain strictly more than 400 English words", () => {
  assert.equal(minimumDiscoveryWords(), 401);
  assert.equal(minimumDiscoveryWords("lower"), 401);
});
test("publisher profile preserves Mongabay taxonomy article and excludes sidebars", () => {
  const prose = "Marine conservation protects complex ecosystems. Researchers studied coastal animals and the effects of mining on the sea. ".repeat(8);
  const result = extractImportedArticleFromHtml(`<html><head><title>Marine conservation</title></head><body><article id="post-12" class="post byline-some-author"><p>${prose}</p></article><div id="series--description-container"><p>UNRELATED SIDEBAR TEXT ${prose}</p></div></body></html>`, "https://news.mongabay.com/2026/09/marine-conservation/");
  assert.ok(result?.article.text.includes("Marine conservation protects"));
  assert.ok(!result?.article.text.includes("UNRELATED SIDEBAR"));
});
test("learning source profile removes practice and marketing but preserves article", () => {
  const prose = "People can learn about the world by reading clear articles that explain the background of important events. ".repeat(20);
  const bne = extractImportedArticleFromHtml(`<html><head><title>Learning story</title></head><body><div class="lesson-excerpt"><article><p>${prose}</p></article></div><h3>Exercises</h3><p>BUY OUR COURSE ${prose}</p></body></html>`, "https://breakingnewsenglish.com/2609/test.html");
  assert.ok(bne?.article.text.includes(prose.trim()));
  assert.ok(!bne?.article.text.includes("BUY OUR COURSE"));
  const nil = extractImportedArticleFromHtml(`<html><head><title>News story</title></head><body><div id="nContent"><p>${prose}</p><p>Difficult words: world</p></div><h3>Reading</h3><p>LEARNING INSTRUCTIONS ${prose}</p></body></html>`, "https://www.newsinlevels.com/products/test-level-3");
  assert.ok(!nil?.article.text.includes("LEARNING INSTRUCTIONS"));
  assert.ok(!nil?.article.text.includes("Difficult words"));
});
test("paywall and sponsorship evidence survives removal of page noise", () => {
  const prose = "A detailed article with an introduction and careful background explanation. ".repeat(20);
  const result = extractImportedArticleFromHtml(`<html><head><title>Sample</title><script type="application/ld+json">{"isAccessibleForFree":false}</script></head><body><span>Sponsored content</span><article><p>${prose}</p></article></body></html>`, "https://example.com/story");
  assert.equal(result?.metadata.intakeWarnings?.length, 2);
});
test("Level Read retains reading paragraphs, not word lookup or other stories", () => {
  const prose = "Readers can learn how international trade changes the lives of ordinary people in many different countries. ".repeat(15);
  const result = extractImportedArticleFromHtml(`<html><head><title>Trade | Level Read | Level 3</title></head><body><article><h1>Trade around the world</h1><div class="space-y-8"><div><span>${prose}</span></div></div></article><section><h3>Words</h3><p>UNRELATED DICTIONARY ${prose}</p></section></body></html>`, "https://levelread.com/news/level-3/trade");
  assert.equal(result?.article.title, "Trade around the world");
  assert.ok(result?.article.text.includes("Readers can learn"));
  assert.ok(!result?.article.text.includes("UNRELATED DICTIONARY"));
});
test("Public Domain Review keeps notes but removes its post-article catalogue and promotion", () => {
  const dom = new JSDOM(`<html><head><title>Historical essay</title></head><body>
    <article class="essay-view">
      <div class="essay__footnotes essay__footer__section"><p>Notes</p><ol><li>A scholarly source retained for the reader.</li></ol></div>
      <div class="essay__resources essay__footer__section"><p>Public Domain Works</p><ul><li>UNRELATED RESOURCE CATALOGUE</li></ul></div>
      <div class="essay__further-reading essay__footer__section"><p>Further Reading</p><p>UNRELATED COMMISSION LINKS</p></div>
      <div class="essay-contributors"><p>UNRELATED AUTHOR PROMOTION</p></div>
      <div class="essay-cta"><p>UNRELATED DONATION REQUEST</p></div>
    </article>
  </body></html>`, { url: "https://publicdomainreview.org/essay/example" });
  applyPublisherProfile(dom.window.document, "https://publicdomainreview.org/essay/example");
  assert.ok(dom.window.document.body.textContent?.includes("A scholarly source retained"));
  assert.ok(!dom.window.document.body.textContent?.includes("UNRELATED RESOURCE"));
  assert.ok(!dom.window.document.body.textContent?.includes("UNRELATED COMMISSION"));
  assert.ok(!dom.window.document.body.textContent?.includes("UNRELATED AUTHOR"));
  assert.ok(!dom.window.document.body.textContent?.includes("UNRELATED DONATION"));
});
test("similarity does not equate unrelated short headings", () => {
  assert.equal(similarArticle("New research explains how human memory changes with sleep", "New research explains how human memory changes with sleep"), true);
  assert.equal(similarArticle("Science today", "Science today"), false);
  assert.equal(similarArticle("The history of ancient painting and cultural traditions", "Space telescopes discover planets orbiting distant stars"), false);
});
