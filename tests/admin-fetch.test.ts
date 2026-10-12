import test from "node:test";
import assert from "node:assert/strict";
import { adminFetch } from "../lib/adminFetch";

test("concurrent Admin reads share transport but each consumer can read its response", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ ok: true }); };
  try {
    const responses = await Promise.all([adminFetch("/api/admin/models?config=1"), adminFetch("/api/admin/models?config=1")]);
    assert.equal(calls, 1);
    assert.deepEqual(await Promise.all(responses.map(response => response.json())), [{ ok: true }, { ok: true }]);
    await adminFetch("/api/admin/models?config=1");
    assert.equal(calls, 2, "completed private responses are not cached");
    await Promise.all([adminFetch("/api/admin/models", { method: "PATCH" }), adminFetch("/api/admin/models", { method: "PATCH" })]);
    assert.equal(calls, 4, "mutations are never merged");
  } finally { globalThis.fetch = original; }
});
test("a failed read is evicted and can be retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; if (calls === 1) throw Error("offline"); return Response.json({ ok: true }); };
  try {
    await assert.rejects(adminFetch("/api/admin/failure"));
    assert.equal((await adminFetch("/api/admin/failure")).status, 200);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
