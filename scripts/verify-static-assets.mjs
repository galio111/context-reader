import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

// Run against a local production build, never substitute this for browser interaction checks.
const base = process.argv[2] || 'http://127.0.0.1:3218';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Local production server required');
const root = '.next/static';
let count = 0, sample;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!/\.(js|css)$/.test(file)) continue;
    const resource = '/_next/static/' + relative(root, file).replaceAll('\\', '/');
    const response = await fetch(base + resource, { headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(response.status, 200, resource);
    assert.equal(response.headers.get('content-encoding'), 'br', resource);
    assert.match(response.headers.get('vary'), /Accept-Encoding/i);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /javascript/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file), resource);
    sample = resource; count++;
  }
}
await walk(root);
assert.ok(sample);
const fallback = await fetch(base + sample, { headers: { 'accept-encoding': 'gzip, br;q=0' } });
assert.equal(fallback.status, 200);
assert.notEqual(fallback.headers.get('content-encoding'), 'br');
await fallback.arrayBuffer();
const missing = await fetch(base + '/_next/static/nonexistent-build.js', { headers: { 'accept-encoding': 'br' } });
assert.equal(missing.status, 404);
console.log(JSON.stringify({ byteIdenticalBrotliAssets: count, legacyFallback: true, missingAsset404: true }));
