import assert from 'node:assert/strict';
import { readdir, mkdir, writeFile } from 'node:fs/promises';

// Exercise the real production middleware + Brotli rewrite, on a fresh local server.
// The deliberate rate-limit load must never be pointed at production.
const base = process.env.AUDIT_BASE || 'http://127.0.0.1:3247';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'local audit server required');
const output = process.env.AUDIT_OUTPUT || 'artifacts/architecture-audit/static-loading';
await mkdir(output, { recursive: true });
const css = (await readdir('.next/static/css')).find(name => name.endsWith('.css'));
assert.ok(css, 'build has a stylesheet');
const asset = '/_next/static/css/' + css;
const report = { base, asset, staticSucceeded: 0, apiSucceeded: 0, apiLimited: null, finalStaticSucceeded: false };
try {
  for (let index = 0; index < 240; index++) {
    const response = await fetch(base + asset, { headers: { 'accept-encoding': 'br' } });
    assert.equal(response.status, 200, `static request ${index + 1}`);
    assert.match(response.headers.get('content-type') || '', /^text\/css/);
    assert.equal(response.headers.get('content-encoding'), 'br');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('cache-control') || '', /immutable/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
    report.staticSucceeded++;
  }
  // A missing GET route exercises middleware without invoking any provider/account mutation.
  for (let index = 0; index < 121; index++) {
    const response = await fetch(base + '/api/__architecture_missing_read_only_probe');
    const body = await response.text();
    if (index < 120) {
      assert.equal(response.status, 404, `ordinary API request ${index + 1} keeps its original allowance`);
      report.apiSucceeded++;
    } else {
      assert.equal(response.status, 429);
      assert.equal(JSON.parse(body).code, 'site_rate_limit');
      assert.equal(response.headers.get('ratelimit-limit'), '120');
      report.apiLimited = { status: response.status, body: JSON.parse(body), retryAfter: response.headers.get('retry-after') };
    }
  }
  const final = await fetch(base + asset, { headers: { 'accept-encoding': 'br' } });
  assert.equal(final.status, 200, 'exhausted API allowance must not replace a stylesheet with JSON');
  assert.match(final.headers.get('content-type') || '', /^text\/css/);
  await final.arrayBuffer();
  report.finalStaticSucceeded = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
}
await writeFile(output + '/result.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
