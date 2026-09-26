import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

test("dictionary route keeps one usage reservation when retryable primary fails over", async () => {
  const require = createRequire(import.meta.url);
  const restore: Array<() => void> = [];
  const mock = (path: string, exports: object) => {
    const id = require.resolve(path), prior = require.cache[id];
    require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
    restore.push(() => { if (prior) require.cache[id] = prior; else delete require.cache[id]; });
  };
  const reservations: unknown[] = [], finishes: unknown[] = [], refunds: unknown[] = [], executions: Array<{model: string}> = [];
  mock("../lib/usageGate", { gateUsage: async (_request: Request, input: unknown) => { reservations.push(input); return {actionId: "one-action"}; }, usageErrorResponse: () => null });
  mock("../lib/accountStore", { finishUsage: async (...args: unknown[]) => { finishes.push(args); }, refundUsage: async (...args: unknown[]) => { refunds.push(args); }, recordUsageExecution: async (value: {model: string}) => { executions.push(value); } });
  const env = {...process.env}, originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "test-primary"; process.env.ZHIPU_API_KEY = "test-backup";
  const models: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model; models.push(model);
    if (model === "deepseek-flash") return new Response("busy", {status: 503});
    const content = [{type: "head", query: "context", lemma: "context", direction: "en_to_cn", inputStatus: "valid"}, {type: "sense", partOfSpeech: "noun", meaning: "语境", exampleEnglish: "Read in context.", exampleChinese: "在语境中阅读。"}, {type: "usage", value: "上下文帮助理解词义。"}, {type: "done"}].map(x => JSON.stringify(x)).join("\n");
    return new Response(`data: ${JSON.stringify({choices: [{delta: {content}}]})}\n\ndata: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
  };
  try {
    const {POST} = await import("../app/api/dictionary-stream/route");
    const response = await POST(new Request("https://context-reader.com/api/dictionary-stream", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({query: "context"})}));
    assert.equal(response.status, 200); assert.match(await response.text(), /语境/);
    assert.deepEqual(models, ["deepseek-flash", "glm-4.5-air"]);
    assert.equal(reservations.length, 1); assert.equal((reservations[0] as {units: number}).units, 1);
    assert.deepEqual(finishes, [["one-action", "succeeded"]]); assert.deepEqual(refunds, []);
    assert.equal(executions.length, 1); assert.equal(executions[0].model, "glm-4.5-air");
  } finally { globalThis.fetch = originalFetch; process.env = env; restore.reverse().forEach(fn => fn()); }
});
