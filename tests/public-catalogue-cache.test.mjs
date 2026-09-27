import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("public catalogue canonicalizes metadata keys, retires old copies and preserves other offline content", async () => {
  const entries = new Map();
  const key = request => typeof request === "string" ? request : request.url;
  const cache = {
    match: async (request) => entries.get(key(request))?.clone(),
    put: async (request, response) => { entries.set(key(request), response.clone()); },
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    delete: async request => entries.delete(key(request)),
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
  entries.set(request.url, new Response("obsolete inline previews"));
  const detailKey = "https://context-reader.com/api/public-articles/retained";
  entries.set(detailKey, new Response("offline article"));

  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 1);
  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 1, "a fresh local catalogue should use zero network requests");

  now += 61_000;
  assert.deepEqual(await sandbox.catalogue(request).then((response) => response.json()), { articles: [{ id: "article-with-cover" }] });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.get("If-None-Match"), '"catalogue-v1"');
  const canonical = "https://context-reader.com/api/public-articles?format=metadata-v2";
  assert.equal(Number(entries.get(canonical).headers.get("X-SW-Cached-At")), now);
  assert.equal(entries.has(request.url), false);
  assert.equal(await entries.get(detailKey).text(), "offline article");
  await sandbox.catalogue(new Request("https://context-reader.com/api/public-articles?unused=1"));
  assert.equal(requests.length, 2);
  assert.equal(entries.size, 2);
});
