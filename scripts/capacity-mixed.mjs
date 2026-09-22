// Authorized, finite public-production workload. Does not disable any quota/rate protection.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = 'https://context-reader.com';
const seconds = Number(process.argv[2] || 120);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 120) throw Error('duration must be 10..120 seconds');
const out = process.env.CAPACITY_OUTPUT || 'artifacts/capacity-mixed';
mkdirSync(out, { recursive: true });
const stamp = Date.now();
const release = await fetch(base + '/api/connectivity').then(r => r.json());
if (release.backendMode !== 'mainland_internal') throw Error('Wrong backend');
const catalogue = await fetch(base + '/api/public-articles').then(r => r.json());
if (!catalogue.articles?.length) throw Error('No articles');
const home = await fetch(base).then(r => r.text());
const assets = [...new Set([...home.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1].replaceAll('&amp;', '&')).filter(p => p.startsWith('/_next/static/') && /\.(js|css)(\?|$)/.test(p)))];
const results = [];
const words = ['curiosity', 'resilience', 'observe', 'reflect', 'persist', 'adapt', 'notice', 'balance', 'explore', 'patient'];
async function request(path, body) {
  const start = performance.now();
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(30_000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-context-action-id': randomUUID() }, body: JSON.stringify(body) } : {}) });
    let text = '', firstMs = null;
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    while (true) { const part = await reader.read(); if (part.done) break; firstMs ??= performance.now() - start; text += decoder.decode(part.value, { stream: true }); }
    text += decoder.decode();
    return { status: r.status, firstMs, totalMs: performance.now() - start, text };
  } catch (error) { return { status: 0, firstMs: null, totalMs: performance.now() - start, error: String(error) }; }
}
async function action(kind, index) {
  const user = index % 100;
  const start = performance.now();
  let result;
  if (kind === 'cold') {
    const root = await request('/');
    const loaded = [root]; let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < assets.length) loaded.push(await request(assets[next++])); }));
    result = { status: loaded.every(r => r.status === 200) ? 200 : 0, totalMs: performance.now() - start, requestCount: loaded.length };
  } else if (kind === 'article') {
    const r = await request('/api/public-articles/' + catalogue.articles[index % catalogue.articles.length].id);
    let valid = false; try { valid = !!JSON.parse(r.text).article; } catch {}
    const { text, ...rest } = r; result = { ...rest, valid };
  } else {
    const r = await request('/api/dictionary-stream', { query: words[index % words.length] });
    let events = []; try { events = r.text.trim().split('\n').map(s => JSON.parse(s)); } catch {}
    const { text, ...rest } = r;
    result = { ...rest, done: events.some(e => e.type === 'done'), streamError: events.some(e => e.type === 'error'), code: events[0]?.code };
  }
  const failed = result.status !== 200 || (kind === 'article' && !result.valid) || (kind === 'ai' && (!result.done || result.streamError));
  const slow = kind === 'ai' ? result.firstMs > 5000 : result.totalMs > (kind === 'cold' ? 5000 : 3000);
  results.push({ kind, user, offsetMs: Date.now() - stamp, ...result, failed, slow });
}
const tasks = [];
// 100 online readers, 60 lookups/min, 20 article opens/min, 5 fresh arrivals/min.
// This is an explicit traffic model, not 100 simultaneous expensive requests.
for (let second = 0; second < seconds; second++) {
  tasks.push(new Promise(resolve => setTimeout(resolve, second * 1000)).then(() => action('ai', second)));
  if (second % 3 === 0) tasks.push(new Promise(resolve => setTimeout(resolve, second * 1000 + 350)).then(() => action('article', second / 3)));
  if (second % 12 === 0) tasks.push(new Promise(resolve => setTimeout(resolve, second * 1000 + 700)).then(() => action('cold', second / 12)));
}
const ticker = setInterval(() => console.log(JSON.stringify({ finished: results.length, failed: results.filter(r => r.failed).length, slow: results.filter(r => r.slow).length })), 15_000);
await Promise.all(tasks); clearInterval(ticker);
const after = await fetch(base + '/api/connectivity').then(r => r.json());
const percentile = (xs, p) => xs.sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)];
const summary = Object.fromEntries(['cold', 'article', 'ai'].map(kind => { const rs = results.filter(r => r.kind === kind); return [kind, { count: rs.length, failed: rs.filter(r => r.failed).length, slow: rs.filter(r => r.slow).length, p95Ms: percentile(rs.map(r => r.totalMs), .95), maxMs: Math.max(...rs.map(r => r.totalMs)), ...(kind === 'ai' ? { firstP95Ms: percentile(rs.filter(r => r.firstMs !== null).map(r => r.firstMs), .95) } : {}) }]; }));
const record = { startedAt: new Date(stamp).toISOString(), seconds, profile: { online: 100, lookupsPerMinute: 60, articleOpensPerMinute: 20, coldArrivalsPerMinute: 5, authenticatedSyncIncluded: false }, release, after, sameRelease: release.releaseId === after.releaseId, summary, results };
const file = `${out}/mixed-${stamp}.json`;
writeFileSync(file, JSON.stringify(record, null, 2));
console.log(JSON.stringify({ file, ...record, results: undefined }, null, 2));
