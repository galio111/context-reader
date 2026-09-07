import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { test } from "node:test";
// The standalone Vercel function intentionally has no dependency on the Next.js TypeScript project.
// @ts-expect-error its minimal ESM handler is exercised here as a black-box JavaScript module.
import overseasFetchHandler from "../ops/vercel-overseas-fetcher/api/fetch.mjs";

const root = new URL("../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

async function invokeFetcher(input: {
  method: string;
  token?: string;
  body?: unknown;
}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const request = Readable.from(input.body === undefined ? [] : [Buffer.from(JSON.stringify(input.body))]) as Readable & {
    method: string;
    headers: Record<string, string>;
  };
  request.method = input.method;
  request.headers = input.token ? { "x-context-reader-fetch-token": input.token } : {};
  const headers: Record<string, string> = {};
  let body = "";
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    end(value?: unknown) {
      body = value === undefined ? "" : Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    },
  };
  await overseasFetchHandler(request, response);
  return { status: response.statusCode, headers, body };
}

test("overseas fetcher rejects unauthenticated and non-POST calls", async () => {
  process.env.OVERSEAS_FETCH_TOKEN = "x".repeat(64);
  const noAuth = await invokeFetcher({ method: "POST", body: { url: "https://example.com/" } });
  assert.equal(noAuth.status, 401);
  assert.deepEqual(JSON.parse(noAuth.body), { error: "unauthorized" });

  const wrongMethod = await invokeFetcher({ method: "GET", token: "x".repeat(64) });
  assert.equal(wrongMethod.status, 405);
});

test("overseas fetcher blocks private destinations before making an upstream request", async () => {
  process.env.OVERSEAS_FETCH_TOKEN = "y".repeat(64);
  const result = await invokeFetcher({
    method: "POST",
    token: "y".repeat(64),
    body: { url: "http://127.0.0.1/admin", mode: "html" },
  });
  assert.equal(result.status, 400);
  assert.deepEqual(JSON.parse(result.body), { error: "unsafe-url" });
});

test("mainland integration remains direct-first and narrowly scoped to the dedicated Vercel route", () => {
  const helper = source("lib/overseasFetch.ts");
  assert.match(helper, /safeRemoteFetch\(url/);
  assert.match(helper, /FALLBACK_STATUSES/);
  assert.match(helper, /"context-reader-overseas-fetch\.vercel\.app"/);
  assert.match(helper, /"fetch\.context-reader\.com"/);
  assert.match(helper, /ALLOWED_FETCHER_HOSTS\.has\(endpoint\.hostname\)/);
  assert.match(helper, /endpoint\.pathname !== "\/api\/fetch"/);
  assert.match(helper, /X-Context-Reader-Fetch-Token/);
  assert.match(helper, /x-context-reader-overseas-fetch/);
  assert.match(helper, /assertSafeRemoteUrl\(finalUrl\)/);

  assert.match(source("app/api/import-url/route.ts"), /fetchRemoteDocument\(url/);
  assert.match(source("lib/recommendationFeed.ts"), /fetchRemoteDocument\(source\.feedUrl/);
  assert.match(source("lib/crawlerRobots.ts"), /fetchRemoteDocument\(robotsUrl/);
});

test("standalone Vercel project exposes only the bounded fetch function", () => {
  const config = JSON.parse(source("ops/vercel-overseas-fetcher/vercel.json")) as {
    functions: Record<string, { maxDuration: number }>;
    regions: string[];
  };
  assert.deepEqual(Object.keys(config.functions), ["api/fetch.mjs"]);
  assert.deepEqual(config.regions, ["iad1"]);
  assert.ok(config.functions["api/fetch.mjs"].maxDuration <= 25);

  const handler = source("ops/vercel-overseas-fetcher/api/fetch.mjs");
  assert.match(handler, /const MAX_REQUEST_BYTES = 8 \* 1024/);
  assert.match(handler, /const MAX_RESPONSE_BYTES = 1_500_000/);
  assert.match(handler, /timingSafeEqual/);
  assert.match(handler, /accept-encoding": "identity"/);
  assert.doesNotMatch(handler, /cookie:/i);
  assert.doesNotMatch(handler, /authorization:/i);
});
