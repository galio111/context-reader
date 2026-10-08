import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pronunciation from "../lib/pronunciation";
import * as ssml from "../lib/pronunciationSsml";

test("phonetic requests reject unsupported conversion before synthesis; optional UK r succeeds", async () => {
  const calls: unknown[][] = [];
  const source = readFileSync(new URL("../app/api/pronunciation/route.ts", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const post = runInNewContext(js + "\nPOST", {
    ...pronunciation, ...ssml, Buffer, Response,
    NextResponse: { json: Response.json },
    readJsonBody: (request: Request) => request.json(),
    getPronunciationAudio: async (...args: unknown[]) => {
      calls.push(args);
      return { bytes: new Uint8Array([1,2,3]), filename: "test.mp3", cacheStatus: "hit", voice: "test" };
    },
  }) as (request: Request) => Promise<Response>;
  const request = (body: object) => new Request("https://context-reader.com/api/pronunciation", { method: "POST", body: JSON.stringify(body) });
  for (const phonetic of ["/kæt̚/", "/tɜʃəri/", "/ˈˌkæt/", "/kæˈt/", "<speak>cat</speak>"]) {
    const response = await post(request({ text: "cat", accent: "en-US", phonetic }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "unsupported_pronunciation_phonetic");
  }
  assert.equal(calls.length, 0);
  assert.equal((await post(request({ text: "lever", accent: "en-GB", phonetic: "/ˈliːvə(r)/" }))).status, 200);
  assert.deepEqual(calls[0], ["lever", "en-GB", "ˈliːvə"]);
  assert.equal((await post(request({ text: "take in", accent: "en-US" }))).status, 200);
  assert.equal(calls.length, 2);
});
