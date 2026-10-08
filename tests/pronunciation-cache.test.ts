import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { normalizePronunciationPhonetic, pronunciationSynthesisInput } from "../lib/pronunciationSsml";
import { reviewedPronunciationAudioPhonetic } from "../lib/dictionaryPronunciation";

function harness(options: { readFailures?: number; writeFailure?: boolean; writeGate?: Promise<void>; now?: number; stored?: boolean; providerFailures?: number; providerStatus?: number } = {}) {
  let reads = 0, providers = 0, writes = 0;
  const events: string[] = [];
  const requests: Array<{ request: { text: string; text_type: string; reqid: string; operation: string } }> = [];
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
      upload: async () => { writes++; await options.writeGate; return { error: options.writeFailure ? new Error("storage unavailable") : null }; },
    }),
  };
  const source = readFileSync(new URL("../lib/pronunciationServer.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = {
    createHash, randomUUID, createClient: () => ({ storage }),
    normalizePronunciationText: (value: string) => value.trim().replace(/\s+/g, " "),
    normalizePronunciationPhonetic, pronunciationSynthesisInput, reviewedPronunciationAudioPhonetic,
    process: { env: { SUPABASE_URL: "mock", SUPABASE_SERVICE_ROLE_KEY: "mock", VOLCENGINE_TTS_APP_ID: "mock", VOLCENGINE_TTS_ACCESS_TOKEN: "mock" } },
    Buffer, Uint8Array, AbortSignal, Error, TypeError, Date: class extends Date {static now(){return options.now ?? Date.now();}}, console: { info: (value: string) => events.push(value), error: () => {} },
    fetch: async (_url: string, init: { body: string }) => { requests.push(JSON.parse(init.body)); providers++; if (providers <= (options.providerFailures ?? 0)) { if (options.providerStatus) return new Response("rejected", { status: options.providerStatus }); throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } return new Response(JSON.stringify({ data: Buffer.from(audio).toString("base64") })); },
  };
  const getAudio = runInNewContext(js + "\ngetPronunciationAudio", context) as (text: string, accent: string, phonetic?: string) => Promise<{ bytes: Uint8Array; cacheStatus: string; filename: string }>;
  return { getAudio, events, requests, counts: () => ({ reads, providers, writes }) };
}

test("noun/verb playback uses supported CMU and never reuses the old IPA cache or another reading", async () => {
  const h = harness();
  const plain = await h.getAudio("record", "en-US");
  const noun = await h.getAudio("record", "en-US", "/ˈrekərd/");
  const verb = await h.getAudio("record", "en-US", "/rɪˈkɔːrd/");
  assert.equal(new Set([plain.filename, noun.filename, verb.filename]).size, 3);
  assert.equal(h.requests[0].request.text_type, "plain");
  assert.equal(h.requests[1].request.text_type, "ssml");
  assert.equal(h.requests[1].request.text, '<speak><phoneme alphabet="cmu" ph="R EH1 K AH0 R D">record</phoneme></speak>');
  assert.equal(h.requests[2].request.text, '<speak><phoneme alphabet="cmu" ph="R IH0 K AO1 R D">record</phoneme></speak>');
  const oldIdentity = createHash("sha256").update(["volcengine-v1", "en-US", "en_female_amanda_mars_bigtts", "record", "ipa-ssml-v1", "rɪˈkɔːrd"].join("\n")).digest("hex");
  assert.notEqual(verb.filename, `cr-us-${oldIdentity.slice(0,24)}.mp3`);
  await h.getAudio("record", "en-US", "rɪˈkɔːrd");
  assert.equal(h.counts().providers, 3);
  await h.getAudio("record", "en-GB", "/rɪˈkɔːd/");
  assert.equal(h.counts().providers, 4);
});

test("equivalent CMU transcriptions share corrected audio and unknown IPA never reaches phoneme markup", async () => {
  const h = harness();
  await h.getAudio("tertiary", "en-GB", "/ˈtɜː.ʃəri/");
  await h.getAudio("tertiary", "en-GB", "/ˈtɜːʃəri/");
  assert.equal(h.counts().providers, 1);
  await h.getAudio("tertiary", "en-GB", "/ˈtɜːʃər̩i/");
  assert.deepEqual(h.requests[1].request, { reqid: h.requests[1].request.reqid, text: "tertiary", text_type: "plain", operation: "query" });
});

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
  const options = { writeFailure: true, now: Date.now() };
  const h = harness(options);
  await h.getAudio("hello", "en-US");
  await new Promise(resolve => setImmediate(resolve));
  options.writeFailure = false;
  options.now += 60_001;
  await h.getAudio("hello", "en-US");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.counts().writes, 2);
  await h.getAudio("hello", "en-US");
  assert.equal(h.counts().providers, 1);
  assert.equal(h.counts().writes, 2);
});

test("a slow Storage write never delays the first successful playback or its concurrent replay", async () => {
  let finish!: () => void;
  const h = harness({ writeGate: new Promise<void>(resolve => {finish=resolve;}) });
  const first = await Promise.race([h.getAudio("hello","en-US"), new Promise<never>((_, reject)=>setTimeout(()=>reject(Error("playback waited for storage")),100))]);
  const second = await h.getAudio("hello","en-US");
  assert.deepEqual([...first.bytes],[...second.bytes]);
  assert.equal(h.counts().providers,1);
  finish();await new Promise(resolve=>setImmediate(resolve));
});

test("contemplate uses reviewed US phones and shares the correction across plain and dictionary requests", async () => {
  const h = harness();
  await h.getAudio("contemplate", "en-US");
  await h.getAudio("contemplate", "en-US", "/ˈkɑːntəmpleɪt/");
  assert.equal(h.counts().providers, 1);
  assert.equal(h.requests[0].request.text, '<speak><phoneme alphabet="cmu" ph="K AA1 N T AH0 M P L EY0 T">contemplate</phoneme></speak>');
  await h.getAudio("contemplate", "en-GB");
  assert.equal(h.requests[1].request.text_type, "plain");
});

test("lever uses the approved CMU tail, equivalent US notation shares audio, and a requested variant stays distinct", async () => {
  const h = harness();
  const plain = await h.getAudio("lever", "en-US");
  const explicit = await h.getAudio("lever", "en-US", "/ˈlevər/");
  const rhotic = await h.getAudio("lever", "en-US", "/ˈlɛvɚ/");
  assert.equal(plain.filename, explicit.filename);
  assert.equal(plain.filename, rhotic.filename);
  assert.equal(h.counts().providers, 1);
  assert.equal(h.requests[0].request.text, '<speak><phoneme alphabet="cmu" ph="L EH1 V ER0">lever</phoneme></speak>');
  const variant = await h.getAudio("lever", "en-US", "/ˈliːvər/");
  assert.notEqual(variant.filename, plain.filename);
  assert.match(h.requests[1].request.text, /L IY1 V ER0/);
  await h.getAudio("lever", "en-GB");
  assert.equal(h.requests[2].request.text_type, "plain");
});


test("one transient TTS timeout retries inside the existing deduplicated request", async () => {
  const h = harness({ providerFailures: 1 });
  const results = await Promise.all([h.getAudio("test", "en-US"), h.getAudio("test", "en-US")]);
  assert.equal(results.length, 2);
  assert.equal(h.counts().providers, 2);
  await h.getAudio("test", "en-US");
  assert.equal(h.counts().providers, 2);
});

test("monosyllable ending bypasses old tail audio and equivalent IPA still shares one recording", async () => {
  const h = harness();
  const first = await h.getAudio("peg", "en-US", "/peɡ/");
  const equivalent = await h.getAudio("peg", "en-US", "/pɛɡ/");
  assert.equal(first.filename, equivalent.filename);
  assert.equal(h.counts().providers, 1);
  assert.equal(h.requests[0].request.text, '<speak><phoneme alphabet="cmu" ph="P EH1 G">peg</phoneme>.</speak>');
  const oldInput = '<speak><phoneme alphabet="cmu" ph="P EH1 G">peg</phoneme></speak>';
  const oldKey = createHash("sha256").update(["volcengine-v1", "en-US", "en_female_amanda_mars_bigtts", "peg", "cmu-ssml-v2", "ssml", oldInput].join("\n")).digest("hex");
  assert.notEqual(first.filename, `cr-us-${oldKey.slice(0,24)}.mp3`);
  await h.getAudio("peg", "en-GB", "/peɡ/");
  assert.ok(h.requests[1].request.text.endsWith("</phoneme></speak>"));
});

test("ordinary requests preserve accepted peg and humiliate recordings while other words keep the Reader path", async () => {
  const h = harness();
  for (const [word, ipa, filename] of [
    ["peg", "/peɡ/", "cr-us-73928ba61d67ddfea37528cc.mp3"],
    ["humiliate", "/hjuːˈmɪliˌeɪt/", "cr-us-1e1b4050a21438b28abcaa19.mp3"],
  ]) {
    const normal = await h.getAudio(word, "en-US");
    const accepted = await h.getAudio(word, "en-US", ipa);
    assert.equal(normal.filename, filename);
    assert.equal(normal.filename, accepted.filename);
  }
  await h.getAudio("bibliography", "en-US");
  assert.equal(h.requests[2].request.text_type, "plain");
  assert.equal(h.requests[2].request.text, "bibliography");
  const variant = await h.getAudio("humiliate", "en-US", "/hjuːˈmɪlieɪt/");
  assert.notEqual(variant.filename, "cr-us-1e1b4050a21438b28abcaa19.mp3");
  await h.getAudio("humiliate", "en-GB");
  assert.equal(h.requests[4].request.text_type, "plain");
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
