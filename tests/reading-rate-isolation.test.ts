import test from "node:test";
import assert from "node:assert/strict";
import { protectApiRequest } from "../lib/requestSecurity";

const origin = "https://context-reader.com";
let nextAddress = 1;
function client() {
  const address = `203.0.113.${nextAddress++}`;
  return (path: string, method = "POST", headers: Record<string, string> = {}) => protectApiRequest(new Request(origin + path, {
    method, headers: { "x-real-ip": address, Origin: origin, ...headers },
  }));
}

test("normal reading has no per-minute or shared daily middleware request cap", () => {
  const request = client();
  const paths = [
    "/api/explain-word-stream", "/api/explain-word", "/api/dictionary-stream", "/api/dictionary",
    "/api/ask-sentence", "/api/summarize-article", "/api/translate-article/start",
    "/api/translate-article", "/api/translate-article/finish", "/api/pronunciation", "/api/usage/cache-lookup",
    ...["explain", "stream", "dictionary", "ask", "translate", "pronunciation"].map(operation => `/api/extension/execute/${operation}`),
  ];
  // One lookup legitimately starts two requests. Exercise well beyond the old
  // 20/minute, global 120/minute, 500/day and pronunciation 2000/day thresholds.
  for (let count = 0; count < 2_001; count++) {
    for (const path of paths) assert.equal(request(path), null, `${count + 1}: ${path}`);
  }
  // Reading must not consume the unrelated ordinary API budget either.
  for (let count = 0; count < 120; count++) assert.equal(request("/api/connectivity", "GET"), null);
  assert.equal(request("/api/connectivity", "GET")?.status, 429);
});

test("an exhausted ordinary or sync bucket cannot block reading or session recovery", () => {
  const request = client();
  for (const path of ["/api/connectivity", "/api/account/sync", "/api/study"]) {
    for (let count = 0; count < 120; count++) assert.equal(request(path, "GET"), null);
    assert.equal(request(path, "GET")?.status, 429);
  }
  for (const [path, method] of [
    ["/api/explain-word-stream", "POST"], ["/api/explain-word", "POST"],
    ["/api/translate-article/finish", "POST"], ["/api/usage/cache-lookup", "POST"],
    ["/api/auth/session", "GET"], ["/api/dictionary-history", "GET"],
  ]) assert.equal(request(path, method), null, path);
});

test("study reconciliation has an independent bounded bucket and cannot exhaust unrelated APIs", () => {
  const request=client();
  for(let count=0;count<120;count++)assert.equal(request("/api/study"),null);
  assert.equal(request("/api/study")?.status,429);
  assert.equal(request("/api/connectivity","GET"),null);
  assert.equal(request("/api/auth/phone-login"),null);
  assert.equal(request("/api/explain-word-stream"),null);
});

test("reading exemption preserves body, origin, authentication-attempt and route boundaries", () => {
  const request = client();
  for (const path of ["/api/explain-word", "/api/ask-sentence", "/api/dictionary-stream"]) {
    assert.equal(request(path, "POST", { "Content-Length": String(64 * 1024 + 1) })?.status, 413);
    assert.equal(request(path, "POST", { "Sec-Fetch-Site": "cross-site" })?.status, 403);
  }
  for (let count = 0; count < 5; count++) assert.equal(request("/api/auth/phone-login"), null);
  assert.equal(request("/api/auth/phone-login", "POST", { Cookie: "context_reader_access=unverified" })?.status, 429);
  assert.equal(request("/api/admin/models", "PUT", { Origin: "https://invalid.example" })?.status, 403);
  for (const [path, method] of [
    ["/api/explain-word", "GET"], ["/api/explain-word/extra", "POST"],
    ["/api/extension/execute/unknown", "POST"], ["/api/auth/session", "POST"],
  ]) {
    const other = client();
    for (let count = 0; count < 120; count++) assert.equal(other(path, method), null);
    assert.equal(other(path, method)?.status, 429, `${method} ${path}`);
  }
});
