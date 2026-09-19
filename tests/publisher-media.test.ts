import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractImportedArticleFromHtml } from '../lib/urlArticleExtractor';
import { removeFailedArticleImages } from '../lib/articleMedia';
const prose = '<p>Researchers studied the surrounding habitat for twenty years and found that restoring wetlands benefits wildlife and local communities.</p><p>The project now protects clean water and provides shelter for many species throughout the changing seasons.</p>';
function extract(fragment: string, url = 'https://www.nasa.gov/story/') {
  return extractImportedArticleFromHtml(`<html><head><title>Habitat restoration</title></head><body><article><h1>Habitat restoration</h1>${fragment}${prose}</article></body></html>`, url)!.article;
}
test('nested carousel figures retain images and separate captions; video-only captions are omitted', () => {
  const article = extract('<div class="image-carousel-slider"><figure><div><figure><img src="/photo.jpg" width="900" height="600" alt="Habitat"></figure><figcaption><div>Restoration ceremony.</div><div>Members gather at the station.</div><div class="hds-credits">NASA</div></figcaption></div></figure><figure><div><figure><video><source src="/loop.mp4"></video></figure><figcaption>Video-only satellite caption.</figcaption></div></figure></div>');
  assert.equal(article.blocks.filter(b => b.type === 'image').length, 1);
  assert.match(article.text, /Restoration ceremony\. Members gather/);
  assert.doesNotMatch(article.text, /Video-only|NASA/);
});
test('rejected image has no orphan caption', () => {
  const article = extract('<figure><img src="/icon.jpg" width="30" height="30"><figcaption>Orphan caption.</figcaption></figure>');
  assert.doesNotMatch(article.text, /Orphan caption/);
});
test('series introduction branding is removed without deleting the first real paragraph or photograph', () => {
  const article = extract('<div class="series-intro"><img src="/series.jpg" width="400" height="400"><p>Waterline is an ongoing series funded by a grant.</p></div><figure><img src="/beaver.jpg" width="900" height="600" alt="Beaver"></figure>', 'https://reasonstobecheerful.world/example/');
  assert.doesNotMatch(article.text, /Waterline/);
  assert.deepEqual(article.blocks.filter(b => b.type === 'image').map(b => b.src), ['https://reasonstobecheerful.world/beaver.jpg']);
  assert.match(article.text, /Researchers studied/);
  assert.match(extract('', 'https://reasonstobecheerful.world/plain/').text, /Researchers studied/);
});
test('failed image localization removes its caption and text mirror but preserves following prose and successful captions', () => {
  const article = extract('<figure><img src="/a.jpg" width="900" height="600"><figcaption>Failed image description.</figcaption></figure><figure><img src="/b.jpg" width="900" height="600"><figcaption>Successful image description.</figcaption></figure>');
  const cleaned = removeFailedArticleImages(article, new Set(['https://www.nasa.gov/a.jpg']));
  assert.doesNotMatch(cleaned.text, /Failed image/);
  assert.match(cleaned.text, /Successful image/);
  assert.match(cleaned.text, /Researchers studied/);
});
