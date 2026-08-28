import assert from "node:assert/strict";
import { sanitizeImportedArticleContent } from "../lib/articleContentSanitizer";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import { createUrlImportImageToken, verifyUrlImportImageToken } from "../lib/urlImportImageToken";

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
  "https://images.example.com/photo.jpg?resize=1200,1016",
  "prefer the bounded reader-sized source instead of downloading a needlessly large image",
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

const mediaChromeResult = extractImportedArticleFromHtml(`<!doctype html><html><head>
  <title>Dance training in virtual reality</title><meta property="og:site_name" content="Example Radio">
</head><body><article data-article-body>
  <h1>Dance training in virtual reality</h1>
  <div class="story-meta has-byline">
    <div class="byline byline--block" aria-label="Byline">
      <a rel="author" href="/people/reporter"><img src="/headshot.jpg" alt="Headshot of Chloe Veltman">Chloe Veltman</a>
    </div>
  </div>
  <div class="audio-module">
    <ul class="audio-module-more-tools">
      <li class="audio-tool audio-tool-download">Download</li>
      <li class="audio-tool audio-tool-embed">Embed &lt;iframe src="https://example.com/player" width="100%" title="embedded audio player"&gt;</li>
      <li class="audio-tool audio-tool-transcript">Transcript</li>
    </ul>
  </div>
  <p>The opening paragraph explains how virtual reality lets hesitant dancers practise timing with a patient virtual partner.</p>
  <figure>
    <img src="/dance-floor.jpg" width="1200" height="800" alt="A participant practising on a dance floor">
    <div class="caption-wrap"><div class="caption" aria-label="Image caption"><p>A participant rehearses a sequence before the public demonstration. Chloe Veltman/NPR <b class="hide-caption">hide caption</b></p></div><b class="toggle-caption">toggle caption</b></div>
  </figure>
  <p>Chloe Veltman/NPR</p>
  <p>The final paragraph reports that repeated practice helped participants feel more willing to join other people on a real dance floor.</p>
  <p>Jennifer Example edited the broadcast and digital versions of this story.</p>
  <p>Example Radio does not offer or accept money for coverage or interviews.</p>
</article></body></html>`, "https://example.com/dance-story");

assert(mediaChromeResult, "media-heavy article should still retain its prose");
assert(mediaChromeResult.article.text.includes("virtual reality lets hesitant dancers"));
assert(mediaChromeResult.article.text.includes("real dance floor"));
for (const unwanted of [
  "Headshot of Chloe Veltman",
  "Chloe Veltman",
  "Download",
  "<iframe",
  "Transcript",
  "toggle caption",
  "hide caption",
  "Chloe Veltman/NPR",
  "edited the broadcast",
  "does not offer or accept money",
]) {
  assert(!mediaChromeResult.article.text.includes(unwanted), `article text should exclude ${unwanted}`);
}
assert.equal(mediaChromeResult.article.blocks.filter((block) => block.type === "image").length, 1);
assert.equal(
  mediaChromeResult.article.blocks.find((block) => block.type === "caption")?.text,
  "A participant rehearses a sequence before the public demonstration.",
);

const smithsonianAuthorCardResult = extractImportedArticleFromHtml(`<!doctype html><html><head>
  <title>Jackie the Bald Eagle Has Died</title><meta property="og:site_name" content="Smithsonian Magazine">
</head><body><article data-article-body>
  <h1>Jackie the Bald Eagle Has Died</h1>
  <p>A raptor center in California had been caring for the animal since mid-July, but she had probably been sick long before then.</p>
  <img src="https://th-thumbnailer.cdn-si-edu.com/example=/fit-in/160x80/filters:no_upscale()/https://media.example.com/accounts/headshot/Sara_-_Headshot_thumbnail.png" alt="Sara Hashemi">
  <p>Sara Hashemi | Daily Correspondent</p>
  <figure><img src="https://media.example.com/photos/jackie-photo.jpeg" width="1026" height="684" alt="a bald eagle perched atop a dead tree"></figure>
  <p>The bald eagle became popular with viewers who watched her nest through a public livestream over many years.</p>
  <p>Caregivers said that the bird received treatment after an altercation, while tests revealed a serious underlying illness.</p>
  <img src="https://th-thumbnailer.cdn-si-edu.com/example=/fit-in/200x200/https://media.example.com/accounts/headshot/Sara_-_Headshot_thumbnail.png" width="200" height="200" alt="Sara Hashemi">
  <p>Sara Hashemi</p>
</article></body></html>`, "https://www.smithsonianmag.com/smart-news/jackie");

assert(smithsonianAuthorCardResult, "Smithsonian-style article should remain importable");
assert.deepEqual(
  smithsonianAuthorCardResult.article.blocks.filter((block) => block.type === "image").map((block) => block.src),
  ["https://media.example.com/photos/jackie-photo.jpeg"],
  "author thumbnails should be removed while the actual article image remains",
);
assert(!smithsonianAuthorCardResult.article.text.includes("Sara Hashemi"));
assert(!smithsonianAuthorCardResult.article.text.includes("Daily Correspondent"));

const legacySmithsonianCandidate = sanitizeImportedArticleContent({
  ...smithsonianAuthorCardResult.article,
  text: `${smithsonianAuthorCardResult.article.text}\n\nSara Hashemi | Daily Correspondent\n\nSara Hashemi`,
  blocks: [
    { id: "old-0", type: "heading", text: "Jackie the Bald Eagle Has Died" },
    { id: "old-1", type: "image", src: "https://context-reader.com/storage/v1/object/public/public-article-covers/article-images/author.webp", alt: "Sara Hashemi", width: 160, height: 80 },
    { id: "old-2", type: "paragraph", text: "Sara Hashemi | Daily Correspondent" },
    { id: "old-3", type: "image", src: "https://media.example.com/photos/jackie-photo.jpeg", alt: "a bald eagle perched atop a dead tree", width: 1026, height: 684 },
    { id: "old-4", type: "paragraph", text: "The actual article body remains available to readers after legacy cleanup." },
    { id: "old-5", type: "image", src: "https://media.example.com/accounts/headshot/Sara_Headshot.png", alt: "Sara Hashemi", width: 200, height: 200 },
    { id: "old-6", type: "paragraph", text: "Sara Hashemi" },
  ],
});
assert.equal(legacySmithsonianCandidate.blocks.filter((block) => block.type === "image").length, 1);
assert(!legacySmithsonianCandidate.text.includes("Sara Hashemi"), "stored candidates should be cleaned when reopened");

const legitimateSubjectPortraitResult = extractImportedArticleFromHtml(`<!doctype html><html><head><title>Artist retrospective</title></head><body><article>
  <h1>Artist retrospective</h1>
  <figure><img src="https://media.example.com/exhibitions/artist-in-studio.jpg" width="1200" height="800" alt="The artist standing beside her latest sculpture"></figure>
  <p>The retrospective brings together five decades of sculpture, drawing and installation work from collections around the world.</p>
  <p>Visitors can follow how the artist changed materials as her ideas about public space developed over time.</p>
  <p>The large studio portrait is part of the article itself and must remain visible alongside the reported text.</p>
</article></body></html>`, "https://example.com/artist-retrospective");
assert(legitimateSubjectPortraitResult);
assert.equal(legitimateSubjectPortraitResult.article.blocks.filter((block) => block.type === "image").length, 1);

process.env.URL_IMPORT_TOKEN_SECRET = "test-only-url-import-token-secret-1234567890";
const imageLocalizationToken = createUrlImportImageToken(mediaChromeResult.article);
assert(imageLocalizationToken, "an image-bearing URL import should receive a short-lived image token");
assert(verifyUrlImportImageToken(mediaChromeResult.article, imageLocalizationToken));
assert(!verifyUrlImportImageToken(
  {
    ...mediaChromeResult.article,
    blocks: mediaChromeResult.article.blocks.map((block) => block.type === "image"
      ? { ...block, src: "https://example.com/unapproved-image.jpg" }
      : block),
  },
  imageLocalizationToken,
), "the token must not authorize a different image source");
assert(!verifyUrlImportImageToken(mediaChromeResult.article, `${imageLocalizationToken}x`));
