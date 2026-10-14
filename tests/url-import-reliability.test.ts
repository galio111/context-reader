import assert from "node:assert/strict";
import {test} from "node:test";
import {extractImportedArticleFromHtml} from "../lib/urlArticleExtractor";
const opening = "Independent researchers examined the public evidence and described their methods carefully for readers around the world.";
const ending = "The final paragraph explains what remains uncertain and why further independent research is needed before drawing conclusions.";
test("utility selector classes cannot erase a public article or its ancestors", () => {
 const html = `<html><head><title>A public report with evidence</title></head><body><main><div class="container group/header-newsletter"><article id="article-body" class="group-has-[[data-testid=marfeel-article-header-newsletter-wrapper]_section]/header-newsletter:pt-8 lg:has-[.related-stories]:pt-6"><h1>A public report with evidence</h1><p>${opening}</p><div class="newsletter-signup"><p>Subscribe for weekly promotions.</p></div><div class="related-stories"><p>Unrelated recommendations must be removed.</p></div><p>${ending}</p></article></div></main></body></html>`;
 const result = extractImportedArticleFromHtml(html, "https://time.com/article/report/");
 assert.ok(result?.article.text.includes(opening));
 assert.ok(result?.article.text.includes(ending));
 assert.doesNotMatch(result!.article.text, /Subscribe|Unrelated/);
});
test("a long title and image caption alone are not a successful article", () => {
 const html = `<html><head><title>${opening}</title></head><body><article><h1>${opening}</h1><figure><img src="https://example.org/cover.jpg"><figcaption>${ending}</figcaption></figure></article></body></html>`;
 assert.equal(extractImportedArticleFromHtml(html,"https://example.org/story"),null);
});
test("real hidden and newsletter wrappers stay excluded", () => {
 for(const attr of ['class="newsletter-signup"','hidden','aria-hidden="true"','style="display:none"']) {
  assert.equal(extractImportedArticleFromHtml(`<html><body><article ${attr}><p>${opening}</p><p>${ending}</p></article></body></html>`,"https://example.org/story"),null);
 }
});

test("paragraph-wrapped charts retain order and surrounding prose",()=>{
 const source=`<html><head><title>Research findings</title></head><body><article><p>${opening}<img src="https://example.org/chart.png" width="1200" height="800">${ending}</p></article></body></html>`;
 const r=extractImportedArticleFromHtml(source,'https://example.org/report')!;
 assert.deepEqual(r.article.blocks.map(b=>b.type),['heading','paragraph','image','paragraph']);
 assert.equal(r.article.blocks[1].text,opening);assert.equal(r.article.blocks[3].text,ending);
});
