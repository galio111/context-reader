import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness(options: { readFailures?: number; writeFailure?: boolean; stored?: boolean; providerFailures?: number; providerStatus?: number } = {}) {
  let reads = 0, providers = 0, writes = 0;
  const events: string[] = [];
  const audio = new Uint8Array([1, 2, 3]);
  const storage = {
    getBucket: async () => ({ data: {} }),
    createBucket: async () => ({ error: null }),
    from: () => ({
      download: async () => {
        reads++;
        if (reads <= (options.readFailures ?? 0)) return { error: new Error("storage unavailable") };
        return options.stored ? { data: new Blob([audio]) } : { error: new Error("not found") };
      },
      upload: async () => { writes++; return { error: options.writeFailure ? new Error("storage unavailable") : null }; },
    }),
  };
  const source = readFileSync(new URL("../lib/pronunciationServer.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = {
    createHash, randomUUID, createClient: () => ({ storage }),
    normalizePronunciationText: (value: string) => value.trim().replace(/\s+/g, " "),
    process: { env: { SUPABASE_URL: "mock", SUPABASE_SERVICE_ROLE_KEY: "mock", VOLCENGINE_TTS_APP_ID: "mock", VOLCENGINE_TTS_ACCESS_TOKEN: "mock" } },
    Buffer, Uint8Array, AbortSignal, Error, TypeError, console: { info: (value: string) => events.push(value), error: () => {} },
    fetch: async () => { providers++; if (providers <= (options.providerFailures ?? 0)) { if (options.providerStatus) return new Response("rejected", { status: options.providerStatus }); throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } return new Response(JSON.stringify({ data: Buffer.from(audio).toString("base64") })); },
  };
  const getAudio = runInNewContext(js + "\ngetPronunciationAudio", context) as (text: string, accent: string) => Promise<{ bytes: Uint8Array; cacheStatus: string }>;
  return { getAudio, events, counts: () => ({ reads, providers, writes }) };
}

test("concurrent and repeated requests reuse one generated MP3; accents remain distinct", async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 12 }, () => h.getAudio("Hello", "en-US")));
  const replay = await h.getAudio(" hello ", "en-US");
  assert.equal(replay.cacheStatus, "hit");
  assert.deepEqual(h.counts(), { reads: 1, providers: 1, writes: 1 });
  await h.getAudio("hello", "en-GB");
  assert.equal(h.counts().providers, 2);
});

test("a transient storage failure retries existing audio instead of paying again", async () => {
  const h = harness({ readFailures: 1, stored: true });
  await h.getAudio("hello", "en-US");
  await h.getAudio("hello", "en-US");
  assert.deepEqual(h.counts(), { reads: 2, providers: 0, writes: 0 });
});

test("storage outage preserves playback and successful audio for subsequent requests", async () => {
  const h = harness({ readFailures: 10, writeFailure: true });
  const initial = await h.getAudio("hello", "en-US");
  const replay = await h.getAudio("hello", "en-US");
  assert.deepEqual([...replay.bytes], [...initial.bytes]);
  assert.equal(h.counts().providers, 1);
  assert.equal(h.events.filter(value => JSON.parse(value).event === "pronunciation_provider_request").length, 1);
  assert.ok(h.events.every(value => !value.includes("hello")));
});

test("hot cache evicts least-recently-used entries at its fixed entry limit", async () => {
  const h = harness({ stored: true });
  for (let index = 0; index < 1_001; index++) await h.getAudio(`word${index}`, "en-US");
  await h.getAudio("word1000", "en-US");
  assert.equal(h.counts().reads, 1_001);
  await h.getAudio("word0", "en-US");
  assert.equal(h.counts().reads, 1_002);
  assert.equal(h.counts().providers, 0);
});

test("a failed write is repaired in the background without another synthesis", async () => {
  const options = { writeFailure: true };
  const h = harness(options);
  await h.getAudio("hello", "en-US");
  options.writeFailure = false;
  await h.getAudio("hello", "en-US");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.counts().writes, 2);
  await h.getAudio("hello", "en-US");
  assert.equal(h.counts().providers, 1);
  assert.equal(h.counts().writes, 2);
});


test("one transient TTS timeout retries inside the existing deduplicated request", async () => {
  const h = harness({ providerFailures: 1 });
  const results = await Promise.all([h.getAudio("test", "en-US"), h.getAudio("test", "en-US")]);
  assert.equal(results.length, 2);
  assert.equal(h.counts().providers, 2);
  await h.getAudio("test", "en-US");
  assert.equal(h.counts().providers, 2);
});

test("persistent timeouts stop after two attempts and explicit rejections never retry", async () => {
  const timedOut = harness({ providerFailures: 10 });
  await assert.rejects(timedOut.getAudio("test", "en-US"), { name: "TimeoutError" });
  assert.equal(timedOut.counts().providers, 2);
  for (const status of [401, 403, 429]) {
    const h = harness({ providerFailures: 10, providerStatus: status });
    await assert.rejects(h.getAudio("test", "en-US"));
    assert.equal(h.counts().providers, 1);
  }
});
