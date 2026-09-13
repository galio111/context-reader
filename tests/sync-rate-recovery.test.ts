import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { protectApiRequest } from "../lib/requestSecurity";
import { getLearningStorage, initializeLearningStorage } from "../lib/learningStorage";
import { syncFetch } from "../lib/accountSyncClient";

test("sync pagination retains its limit without consuming login or another address budget", () => {
  const request = (path: string, address = "192.0.2.181") => new Request(`https://context-reader.com${path}`, { headers: { "x-real-ip": address } });
  for (let n = 0; n < 120; n++) assert.equal(protectApiRequest(request("/api/account/sync")), null);
  assert.equal(protectApiRequest(request("/api/account/sync"))?.status, 429);
  assert.equal(protectApiRequest(request("/api/connectivity")), null);
  assert.equal(protectApiRequest(request("/api/account/sync", "192.0.2.182")), null);
  const caddy = readFileSync("ops/mainland/Caddyfile", "utf8");
  assert.match(caddy, /header_up X-Real-IP \{remote_host\}/);
});

test("rate-limited sync waits, retries the same request and preserves the account boundary", async () => {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.window.CustomEvent });
  await initializeLearningStorage();
  const storage = getLearningStorage(); storage.setItem("context-reader:local-account-owner:v1", "owner-a");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1 ? Response.json({}, { status: 429, headers: { "Retry-After": "0" } }) : Response.json({ restored: true });
    assert.equal((await syncFetch("/api/account/sync")).status, 200); assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => { calls++; storage.setItem("context-reader:local-account-owner:v1", "owner-b"); return Response.json({}, { status: 429, headers: { "Retry-After": "0" } }); };
    await assert.rejects(syncFetch("/api/account/sync"), /账号已切换/); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; dom.window.close(); }
});
