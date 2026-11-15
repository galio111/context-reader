import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWebSources, searchExtensionWeb } from '../lib/extensionWebSearch';

test('search sources retain dates and reject executable or malformed links', () => {
  const sources = parseWebSources({ results: [
    { title: 'Unsafe', url: 'javascript:alert(1)', summary: 'bad' },
    { title: 'Empty', url: 'https://example.com/empty', summary: '' },
    { title: 'Report', url: 'https://example.com/news', summary: 'An event happened.', date: '2026-11-15' },
    { title: 'Duplicate', url: 'https://example.com/news', summary: 'Updated report', date: '2026-11-15' },
  ] });
  assert.equal(sources.length, 1);
  assert.match(sources[0].text, /2026-11-15/);
  assert.equal(parseWebSources(null).length, 0);
});

test('search supports emergency disable; approved calls are bounded and failures honest', async () => {
  const priorFetch = globalThis.fetch, priorEnabled = process.env.EXTENSION_WEB_SEARCH_ENABLED, priorKey = process.env.DEEPSEEK_API_KEY;
  let calls = 0;
  try {
    process.env.DEEPSEEK_API_KEY = 'synthetic-test-only';
    process.env.EXTENSION_WEB_SEARCH_ENABLED = 'false';
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.ok(body.query.length <= 128);
      assert.equal(body.count, 5);
      return Response.json({ results: [{ title: 'Person', url: 'https://example.com/person', summary: 'Public biography' }] });
    };
    assert.equal((await searchExtensionWeb('Ada Lovelace')).sources.length, 0);
    assert.equal(calls, 0);
    process.env.EXTENSION_WEB_SEARCH_ENABLED = 'true';
    const found = await searchExtensionWeb('Ada Lovelace');
    assert.equal(found.sources.length, 1); assert.match(found.notice, /已联网/);
    globalThis.fetch = async () => new Response('', { status: 429 });
    const failed = await searchExtensionWeb('latest event');
    assert.equal(failed.sources.length, 0); assert.match(failed.notice, /未取得/);
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async () => { throw new Error('aborted'); };
    await assert.rejects(searchExtensionWeb('event', controller.signal));
  } finally {
    globalThis.fetch = priorFetch;
    if (priorEnabled === undefined) delete process.env.EXTENSION_WEB_SEARCH_ENABLED; else process.env.EXTENSION_WEB_SEARCH_ENABLED = priorEnabled;
    if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
  }
});
