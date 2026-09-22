import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const beforePath = process.argv[2];
const output = process.argv[3];
const base = 'https://context-reader.com';
const before = JSON.parse(readFileSync(beforePath));
const response = await fetch(base + '/api/public-articles');
assert.equal(response.status, 200);
const raw = await response.text(); const after = JSON.parse(raw);
assert.deepEqual(after.articles.map(a => a.id), before.articles.map(a => a.id));
const publicFields = ['title', 'summary', 'sourceUrl', 'sourceName', 'createdAt', 'updatedAt'];
const recommendationFields = ['coverImageUrl', 'coverImageAlt', 'coverImageCredit', 'coverImageSourceUrl', 'difficulty', 'cefr', 'audienceStages', 'topics', 'homepageCategory', 'wordCount', 'timeliness', 'sourceKind', 'classificationSource'];
for (let i = 0; i < before.articles.length; i++) {
  for (const key of publicFields) assert.deepEqual(after.articles[i][key], before.articles[i][key]);
  for (const key of recommendationFields) assert.deepEqual(after.articles[i].recommendation?.[key], before.articles[i].recommendation?.[key]);
}
const checks = {};
for (const [path, expected] of [['/api/account/sync', 401], ['/api/admin/accounts', 401], ['/api/admin/models', 401]]) {
  const r = await fetch(base + path); checks[path] = r.status; assert.equal(r.status, expected);
}
const home = await fetch(base).then(r => r.text());
assert.ok(after.articles.every(a => home.includes(a.id)));
const legacy = await fetch(base + '/home-v2?preview=guest', { redirect: 'manual' });
assert.equal(legacy.status, 308); assert.ok(legacy.headers.get('location')?.endsWith('/?preview=guest'));
const details = await fetch(base + '/api/public-articles/' + after.articles[0].id).then(r => r.json());
assert.ok(details.article.body.length > 100);
assert.ok(details.article.recommendation.editorialReview || details.article.recommendation.difficultyEvidence);
const release = await fetch(base + '/api/connectivity').then(r => r.json());
const result = { passed: true, catalogueCount: after.articles.length, allVisibleFieldsPreserved: true, allIdsServerRendered: true, detailAndEditorialEvidencePreserved: true, beforeCatalogueBytes: Buffer.byteLength(JSON.stringify(before)), afterCatalogueBytes: Buffer.byteLength(raw), legacyRedirect: 308, checks, release };
writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
