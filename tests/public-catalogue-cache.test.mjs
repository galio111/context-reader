import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("public catalogue uses its cached images and revalidates unchanged data without downloading them again", async () => {
  const entries = new Map();
  const cache = {
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => { entries.set(request.url, response.clone()); },
  };
  let now = 1_000_000;
  const requests = [];
  const fetchMock = async (request) => {
    requests.push(request);
    if (request.headers.get("If-None-Match") === '"catalogue-v1"') {
      return new Response(null, { status: 304, headers: { ETag: '"catalogue-v1"' } });
    }
    return new Response(JSON.stringify({ articles: [{ id: "article-with-cover" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: '"catalogue-v1"' },
    });
  };
  const sandbox = {
    caches: { open: async () => cache },
    Date: { now: () => now },
    fetch: fetchMock,
    Headers,
    Request,
    Response,
    URL,
    self: { addEventListener: () => {}, location: { origin: "https://context-reader.com" } },
  };
  vm.runInNewContext(`${readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")}\nglobalThis.catalogue = cachedPublicCatalogue;`, sandbox);
  const request = new Request("https://context-reader.com/api/public-articles?cover=256");

  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 1);
  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 1, "a fresh local catalogue should use zero network requests");

  now += 61_000;
  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.get("If-None-Match"), '"catalogue-v1"');
  assert.equal(Number(entries.get(request.url).headers.get("X-SW-Cached-At")), now);
});
