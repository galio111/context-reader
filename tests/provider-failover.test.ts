import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithProviderFailover, resetProviderCircuitForTests, responseModel } from "../lib/providerFailover";

const input = { method: "POST", body: JSON.stringify({ model: "deepseek-flash", messages: [], stream: true }) };
const chunk = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n';
function ok() { return new Response(chunk); }
test("cross-provider fallback, first-content deadline, cancellation and circuit", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.ZHIPU_API_KEY = "test-backup-key";
  process.env.AI_PRIMARY_WAIT_MS = "20";
  t.after(() => { globalThis.fetch = originalFetch; process.env = env; resetProviderCircuitForTests(); });
  await t.test("busy primary switches once; next request bypasses unhealthy primary", async () => {
    resetProviderCircuitForTests();
    const calls: string[] = [];
    globalThis.fetch = async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model; calls.push(model);
      return model === "deepseek-flash" ? new Response("busy", { status: 503 }) : ok();
    };
    const first = await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", input);
    assert.equal(responseModel(first, "unknown"), "glm-4.5-air");
    assert.equal(await first.text(), chunk);
    assert.equal(await (await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", input)).text(), chunk);
    assert.deepEqual(calls, ["deepseek-flash", "glm-4.5-air", "glm-4.5-air"]);
  });
  await t.test("headers and keepalive without content cannot postpone fallback", async () => {
    resetProviderCircuitForTests();
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      if (++calls === 2) return ok();
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        init?.signal?.addEventListener("abort", () => c.error(init.signal?.reason), { once: true });
      } }));
    };
    assert.equal(await (await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", input)).text(), chunk);
    assert.equal(calls, 2);
  });
  await t.test("client abort cancels without starting backup", async () => {
    resetProviderCircuitForTests();
    const controller = new AbortController(); let calls = 0;
    globalThis.fetch = async (_url, init) => { calls++; return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      controller.abort();
    }); };
    await assert.rejects(fetchWithProviderFailover("https://api.deepseek.com/chat/completions", { ...input, signal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, 1);
  });
  await t.test("input rejection is not retried with another provider", async () => {
    resetProviderCircuitForTests(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("invalid input", { status: 400 }); };
    assert.equal((await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", input)).status, 400);
    assert.equal(calls, 1);
  });
  await t.test("empty JSON completion switches before result is exposed", async () => {
    resetProviderCircuitForTests(); let calls = 0;
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: ++calls === 1 ? "" : "完成" } }] }));
    const response = await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", { ...input, body: JSON.stringify({ model: "deepseek-flash" }) });
    assert.equal(responseModel(response, "unknown"), "glm-4.5-air"); assert.equal(calls, 2);
  });
  await t.test("partial stream is never spliced with another model", async () => {
    resetProviderCircuitForTests(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(chunk)); },
      pull(c) { c.error(new Error("disconnected")); },
    })); };
    const response = await fetchWithProviderFailover("https://api.deepseek.com/chat/completions", input);
    await assert.rejects(response.text()); assert.equal(calls, 1);
  });
});
