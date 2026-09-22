import { LATIN_PHRASE_PATTERN } from "../lib/latinWords";
import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekParseError, explainWordWithDeepSeek } from "../lib/deepseek";
import { lowUsageNotice, quotaExhaustedMessage, usageResetLabel } from "../lib/usagePresentation";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server";
import { explanationFromCompletedStream } from "../lib/explanationDisplay";
import { EXPLANATION_STREAM_COMPLETE_MARKER } from "../lib/explanationStreamProtocol";

const gateSource = readFileSync(new URL("../lib/usageGate.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
const gateJs = ts.transpileModule(gateSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const { UsageGateError, usageErrorResponse } = runInNewContext(gateJs + "\n({ UsageGateError, usageErrorResponse })", { NextResponse, quotaExhaustedMessage });

const quota = { metricKey: "lookup_generation", used: 30, allowance: 30, remaining: 0, windowEnd: "2026-09-17T16:00:00Z", authenticated: true };

test("free and assigned-account quota responses preserve identity, metric and Shanghai reset", async () => {
  const message = quotaExhaustedMessage(quota);
  assert.match(message, /查词与问答.*30 \/ 30/);
  assert.match(message, /9\/18 00:00（北京时间）重置/);
  assert.doesNotMatch(message, /游客|登录后/);
  const response = usageErrorResponse(new UsageGateError(message, 429, "quota_exhausted", quota))!;
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: message, code: "quota_exhausted", quota });
  assert.match(quotaExhaustedMessage({ ...quota, metricKey: "full_article_translation", allowance: 5, used: 5 }), /全文翻译.*5 \/ 5/);
});

test("guest, disabled feature and insufficient units give distinct recovery instructions", () => {
  assert.match(quotaExhaustedMessage({ ...quota, authenticated: false, metricKey: "guest_url_import" }), /网址导入.*登录后可使用账号额度/);
  const disabled = quotaExhaustedMessage({ ...quota, allowance: 0, used: 0 });
  assert.match(disabled, /没有查词与问答额度/);
  assert.doesNotMatch(disabled, /重置/);
  assert.match(quotaExhaustedMessage({ ...quota, remaining: 1 }), /不足以完成本次操作/);
  assert.equal(usageResetLabel("invalid"), "");
});

test("an exhausted pool takes precedence over a merely low pool", () => {
  assert.match(lowUsageNotice([{ ...quota, remaining: 5 }, { ...quota, metricKey: "article_summary" }]), /^文章摘要额度已用完/);
  assert.match(lowUsageNotice([{ ...quota, remaining: 6 }]), /查词与问答剩余 6 \/ 30/);
});

test("failed repair records exact field reasons and truncation without retaining user text", async (t) => {
  const keys = ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_LOOKUP_MODEL", "DEEPSEEK_FALLBACK_MODELS", "DEEPSEEK_FALLBACK_BASE_URL"];
  const saved = keys.map((key) => [key, process.env[key]] as const);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.DEEPSEEK_API_KEY = "test-secret";
  process.env.DEEPSEEK_BASE_URL = "https://provider.invalid";
  process.env.DEEPSEEK_LOOKUP_MODEL = "test-model";
  process.env.DEEPSEEK_FALLBACK_MODELS = "";
  process.env.DEEPSEEK_FALLBACK_BASE_URL = "";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify({ basicMeaning: "English only", contextMeaning: "", sentenceTranslation: 42, phonetic: "/x/", phoneticFor: "different" }) } }], usage: { completion_tokens: 760 } });
  };
  await assert.rejects(explainWordWithDeepSeek({ word: "clear", sentence: "Private article text.", previousSentence: "", nextSentence: "" }), (error: unknown) => {
    assert.ok(error instanceof DeepSeekParseError);
    assert.equal(error.diagnostics.model, "test-model");
    assert.equal(error.diagnostics.repairAttempted, true);
    assert.equal(error.diagnostics.outputTruncated, true);
    assert.match(String(error.diagnostics.fieldIssues), /basicMeaning:no_chinese/);
    assert.match(String(error.diagnostics.fieldIssues), /contextMeaning:empty/);
    assert.match(String(error.diagnostics.fieldIssues), /sentenceTranslation:wrong_type/);
    assert.match(String(error.diagnostics.fieldIssues), /collocation:missing/);
    assert.match(String(error.diagnostics.fieldIssues), /phoneticFor:target_mismatch/);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /Private article|test-secret|English only/);
    return true;
  });
  assert.equal(calls, 2);
  let repairCalls = 0;
  const budgets: number[] = [];
  const first = { basicMeaning: "清晰的", contextMeaning: "清楚的", sentenceTranslation: "区别很清楚。", usageNote: "形容区别。", exampleChinese: "看得很清楚。", collocation: "clear distinction", phonetic: "", phoneticFor: "" };
  globalThis.fetch = async (_url, init) => {
    repairCalls++;
    budgets.push(JSON.parse(String(init?.body)).max_tokens);
    // The repair supplies IPA but drops every other required field.
    const result = repairCalls === 1 ? first : { phonetic: "/klɪr/", phoneticFor: "clear" };
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: {} });
  };
  const recovered = await explainWordWithDeepSeek({ word: "clear", sentence: "The distinction is clear.", previousSentence: "", nextSentence: "" });
  assert.equal(recovered.explanation.contextMeaning, "清楚的");
  assert.equal(recovered.explanation.phoneticFor, "clear");
  assert.deepEqual(budgets, [1200, 1600]);

  globalThis.fetch = async () => new Response("bad gateway", { headers: { "Content-Type": "text/plain" } });
  await assert.rejects(explainWordWithDeepSeek({ word: "clear", sentence: "Private article text.", previousSentence: "", nextSentence: "" }), (error: unknown) => {
    assert.ok(error instanceof DeepSeekParseError);
    assert.equal(error.diagnostics.validationStage, "response_json");
    assert.equal(error.diagnostics.contentType, "text/plain");
    return true;
  });
});


test("stream EOF with missing fields cannot finalize a quota reservation", async () => {
  const source = readFileSync(new URL("../app/api/explain-word-stream/route.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const completeText = "原型：clear\n当前词音标：/klɪr/\n当前词音标归属：clear\n词性：形容词\n难度：简单\n基础释义：清晰的\n当前语境含义：清楚的\n当前句子翻译：区别很清楚。\n用法说明：形容区别。\n常见搭配：clear distinction\n英文例句：It is clear.\n例句中文翻译：这很清楚。";
  for (const [content, expected] of [["基础释义：清楚的", false], [completeText, true]] as const) {
    let finished = 0;
    const statuses: string[] = [];
    const post = runInNewContext(js + "\nPOST", {
      LATIN_PHRASE_PATTERN, providerName: () => "test", NextResponse, Response, ReadableStream, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
      process: { env: { DEEPSEEK_API_KEY: "test" } },
      readJsonBody: (request: Request) => request.json(), RequestBodyTooLargeError: class extends Error {},
      acquireAiSlot: async () => () => {}, gateUsage: async () => ({ actionId: "test-action" }), usageErrorResponse: () => null,
      finishUsage: async () => { finished++; }, recordUsageExecution: async (input: { status: string }) => { statuses.push(input.status); }, refundUsage: async () => {},
      estimateDeepSeekCostMicrousd: () => 0, EXPLANATION_STREAM_COMPLETE_MARKER, explanationFromCompletedStream,
      classifyStreamTermination: () => "failed", registerActiveLookupRequest: () => () => {},
      coreDeepSeekModelCandidates: () => ["test"],
      fetchWithDeepSeekModelFailover: async () => ({ model: "test", response: new Response("data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\ndata: [DONE]\n\n") }),
    });
    const response: Response = await post(new Request("https://test.invalid/api/explain-word-stream", { method: "POST", body: JSON.stringify({ word: "clear", sentence: "It is clear.", previousSentence: "", nextSentence: "" }) }));
    const body = await response.text();
    assert.equal(finished, expected ? 1 : 0);
    assert.equal(body.includes(EXPLANATION_STREAM_COMPLETE_MARKER), expected);
    assert.deepEqual(statuses, [expected ? "succeeded" : "failed"]);
  }
});
