import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEditorialRepair, repairEditorialArticle } from "../lib/editorialRepair";
import { editorialDailyReport } from "../lib/editorialReport";
import type { ImportedArticle } from "../types/article";
import type { PublicArticle } from "../types/publicArticle";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { publisherIntakeWarnings } from "../lib/publisherExtractionProfiles";
import { JSDOM } from "jsdom";
const prose = "This is substantive independent reporting about people and the natural world. ".repeat(45);
const article: ImportedArticle = { title: "Example", url: "https://example.org/a", siteName: "Example", text: prose + "\nSubscribe to our newsletter.", blocks: [{ id: "p", type: "paragraph", text: prose }, { id: "ad", type: "paragraph", text: "Subscribe to our newsletter." }, { id: "end", type: "paragraph", text: "The final substantive paragraph must remain intact." }, { id: "img", type: "image", src: "https://example.org/photo.jpg", alt: "Article illustration" }] };
const proposal = { uncertain: false, remove: [{ id: "ad", text: "Subscribe to our newsletter.", category: "newsletter", reason: "standalone signup" }] };
test("repair removes agreed middle furniture while retaining exact prose, end, images and IDs", () => {
  const result = applyEditorialRepair(article, proposal, proposal);
  assert.equal(result.removed.length, 1);
  assert.deepEqual(result.article.blocks, article.blocks.filter((b) => b.id !== "ad"));
  assert.ok(result.article.text.includes("final substantive paragraph"));
  assert.ok(!result.article.text.includes("Subscribe"));
});
test("disagreement, uncertainty, invented text and excessive deletion cannot modify content", () => {
  for (const bad of [{ uncertain: true, remove: proposal.remove }, { uncertain: false, remove: [] }, { uncertain: false, remove: [{ ...proposal.remove[0], text: "invented" }] }]) assert.equal(applyEditorialRepair(article, proposal, bad).article, article);
  const excessive = { uncertain: false, remove: [{ ...proposal.remove[0], id: "p", text: prose }] };
  assert.equal(applyEditorialRepair(article, excessive, excessive).article, article);
});
test("repair cannot delete images, captions or quotations to hide defects", () => {
  for (const type of ["image", "caption", "quote", "table"] as const) {
    const copy = { ...article, blocks: article.blocks.map((b) => b.id === "ad" ? { ...b, type } : b) };
    assert.equal(applyEditorialRepair(copy, proposal, proposal).article, copy);
  }
});
test("failed repair preserves original and never supplies an approval", async () => {
  const result = await repairEditorialArticle(article, async () => { throw new Error("provider unavailable"); });
  assert.equal(result.article, article); assert.equal(result.evidence, undefined);
});
test("email reports exact published counts, zero categories, primary topics and difficulties", () => {
  const rows = [{ title: "One", sourceUrl: "https://example.org/a", recommendation: { difficulty: "CET-6 / 考研", topics: ["商业经济", "社会生活"] } }] as PublicArticle[];
  const report = editorialDailyReport("2026-09-20", rows, 3, false);
  assert.match(report.subject, /未达标 1\/35/);
  assert.match(report.text, /商业：1 篇/); assert.match(report.text, /科学：0 篇/);
  assert.match(report.text, /商业经济：1 篇/); assert.match(report.text, /社会生活：0 篇/);
  assert.match(report.text, /CET-6 \/ 考研：1 篇/);
});

test("public Popsci article container is retained while actual subscription overlay is removed", () => {
  const html = `<html><title>A real story</title><body><article><div class="entry-content Article-bodyText paywall"><p>${prose}</p><p>The actual ending is here.</p><img src="https://www.popsci.com/photo.jpg" width="900" height="600" /></div><aside class="paywall">Subscribe to continue</aside></article></body></html>`;
  const result = extractImportedArticleFromHtml(html, "https://www.popsci.com/environment/story");
  assert.ok(result?.article.text.includes(prose.trim()));
  assert.ok(result?.article.text.includes("The actual ending is here."));
  assert.ok(!result?.article.text.includes("Subscribe to continue"));
  assert.equal(result?.article.blocks.filter((b) => b.type === "image").length, 1);
});

test("Global Voices footer boundary preserves the complete story before categories", () => {
  const html = `<html><title>A real story</title><body><article><p>${prose}</p><p>A second substantive paragraph explains what actually happened in the community.</p><p>The final substantive paragraph includes the complete conclusion and its context.</p><h3>Categories</h3><p>Written bySomeone</p><h3>Top World Stories</h3></article></body></html>`;
  const result = extractImportedArticleFromHtml(html, "https://globalvoices.org/2026/09/20/story/");
  assert.ok(result?.article.text.includes("complete conclusion"));
  assert.ok(!result?.article.text.includes("Top World Stories"));
});

test("sponsored related card cannot condemn an independent article, but the article's own label blocks", () => {
  const url = "https://www.popsci.com/technology/real-story";
  const card = '<div class="post-content"><span>Sponsored Content</span><a class="card-post-title-link" href="/sponsored/other-story">Other story</a></div>';
  const document = new JSDOM(`<article><h1>Real story</h1><p>${prose}</p></article>${card}`, { url }).window.document;
  assert.deepEqual(publisherIntakeWarnings(document, url), []);
  const own = document.createElement("span"); own.textContent = "Sponsored Content";
  document.querySelector("article")!.prepend(own);
  assert.ok(publisherIntakeWarnings(document, url).some((s) => s.includes("赞助")));
});


test("Guardian share and related-story footer is removed without changing the ending", () => {
  const html = `<html><title>Report</title><body><article><p>${prose}</p><p>The reporter explains the final outcome and the remaining uncertainty.</p><div>ShareReuse this content</div><h2>More on this story</h2><p>Unrelated news teaser.</p></article></body></html>`;
  const result = extractImportedArticleFromHtml(html, "https://www.theguardian.com/business/2026/sep/20/report");
  assert.ok(result?.article.text.includes("remaining uncertainty"));
  assert.ok(!result?.article.text.includes("Unrelated news teaser"));
  assert.ok(!result?.article.text.includes("Reuse this content"));
});
