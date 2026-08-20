import assert from "node:assert/strict";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";

const result = extractImportedArticleFromHtml(`<!doctype html>
<html lang="en">
  <head>
    <title>Test Article</title>
    <meta property="og:site_name" content="Test Journal">
    <meta property="og:image" content="/cover.jpg">
  </head>
  <body>
    <nav>Home Topics Subscribe</nav>
    <article>
      <header><h1>Test Article</h1><p class="byline">By A. Writer</p></header>
      <p>The opening paragraph contains enough real article language to establish a reliable body boundary for this test.</p>
      <div hidden><p>Invisible crawler bait must never be imported.</p></div>
      <div style="display:none"><p>CSS-hidden keyword stuffing must never be imported.</p></div>
      <div aria-hidden="true"><p>ARIA-hidden duplicate content must never be imported.</p></div>
      <div class="advertisement"><p>Buy this unrelated product today.</p></div>
      <p>The second paragraph contains a <a href="/source">legitimate inline source link</a> that belongs to the article.</p>
      <figure>
        <img src="/chart.jpg" width="900" height="600" alt="Research results by year">
        <figcaption>Figure 1. Results across the study period.</figcaption>
      </figure>
      <ol start="3"><li>First retained step</li><li>Second retained step<ul><li>Nested evidence</li></ul></li></ol>
      <table>
        <caption>Population estimates</caption>
        <thead><tr><th scope="col">Year</th><th scope="col">Population</th></tr></thead>
        <tbody><tr><th scope="row">2025</th><td rowspan="2">42 million</td></tr><tr><th scope="row">2026</th></tr></tbody>
      </table>
      <p>The final paragraph is essential and must remain after the table so completeness is tested at the article boundary.</p>
      <section class="related-articles">
        <a class="story-card" href="/other-story"><img src="/other.jpg" width="1200" height="800" alt="Other story">Read another story</a>
      </section>
    </article>
    <footer>Copyright and more stories</footer>
  </body>
</html>`, "https://example.com/story");

assert(result, "extractor should return an article");
assert.equal(result.article.title, "Test Article");
assert.equal(result.article.siteName, "Test Journal");
assert(!result.article.text.includes("crawler bait"));
assert(!result.article.text.includes("keyword stuffing"));
assert(!result.article.text.includes("Buy this unrelated product"));
assert(!result.article.text.includes("Read another story"));
assert(result.article.text.includes("legitimate inline source link"));
assert(result.article.text.includes("The final paragraph is essential"));

const images = result.article.blocks.filter((block) => block.type === "image");
assert.equal(images.length, 1);
assert.equal(images[0]?.src, "https://example.com/chart.jpg");
assert.equal(result.article.blocks.find((block) => block.type === "caption")?.text, "Figure 1. Results across the study period.");

const listItems = result.article.blocks.filter((block) => block.type === "list-item");
assert.deepEqual(listItems.map((item) => [item.text, item.listStyle, item.listLevel, item.listOrdinal]), [
  ["First retained step", "ordered", 0, 3],
  ["Second retained step", "ordered", 0, 4],
  ["Nested evidence", "unordered", 1, undefined],
]);

const table = result.article.blocks.find((block) => block.type === "table");
assert(table?.table, "table should remain structured");
assert.equal(table.table.caption, "Population estimates");
assert.equal(table.table.rows.length, 3);
assert.equal(table.table.rows[0]?.[0]?.header, true);
assert.equal(table.table.rows[0]?.[0]?.scope, "col");
assert.equal(table.table.rows[1]?.[1]?.rowSpan, 2);
assert(result.metadata.coverCandidates.includes("https://example.com/cover.jpg"));

console.log(JSON.stringify({
  title: result.article.title,
  blockTypes: result.article.blocks.map((block) => block.type),
  textCharacters: result.article.text.length,
  imageCount: images.length,
  tableRows: table.table.rows.length,
}, null, 2));

const commaSrcset = extractImportedArticleFromHtml(`<!doctype html><html><head><title>Image URL Test</title></head><body><article>
  <h1>Image URL Test</h1>
  <figure><img width="2048" height="1734" src="https://images.example.com/photo.jpg?w=2048" srcset="https://images.example.com/photo.jpg 2048w, https://images.example.com/photo.jpg?resize=1200,1016 1200w, https://images.example.com/photo.jpg?resize=2000,1693 2000w" alt="A meaningful article image"></figure>
  <p>This paragraph is long enough to make the image source parser test a valid article candidate without relying on page chrome.</p>
  <p>The second paragraph confirms that an image URL containing a comma is not split into a bogus relative URL.</p>
</article></body></html>`, "https://example.com/story");
assert(commaSrcset);
assert.equal(
  commaSrcset.article.blocks.find((block) => block.type === "image")?.src,
  "https://images.example.com/photo.jpg?resize=2000,1693",
);

const longTableRows = Array.from(
  { length: 220 },
  (_, index) => `<tr><td>Row ${index + 1}</td><td>Value ${index + 1}</td></tr>`,
).join("");
const longTableResult = extractImportedArticleFromHtml(
  `<html><head><title>Long table</title></head><body><main><h1>Long table</h1><p>This reference article contains a complete country-style table.</p><table><thead><tr><th scope="col">Name</th><th scope="col">Code</th></tr></thead><tbody>${longTableRows}</tbody></table></main></body></html>`,
  "https://example.com/long-table",
);
const longTable = longTableResult?.article.blocks.find((block) => block.type === "table");
assert.equal(longTable?.table?.rows.length, 221, "long but bounded tables should not be truncated at the former 150-row limit");
