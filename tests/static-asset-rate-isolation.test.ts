import test from "node:test";
import assert from "node:assert/strict";
import { protectApiRequest } from "../lib/requestSecurity";

const origin = "https://context-reader.com";
const staticPath = "/api/static-asset/css/build-a123.css";
let nextAddress = 1;

function client() {
  // Exercise the real public protection function without sharing rate windows
  // across cases or clearing its production store.
  const address = `198.51.100.${nextAddress++}`;
  return (path: string, method = "GET", headers: Record<string, string> = {}) => protectApiRequest(new Request(origin + path, {
    method,
    headers: { "x-real-ip": address, Origin: origin, ...headers },
  }));
}

test("141 and 240 cold static reads leave the original AI and API limits available", () => {
  for (const count of [141, 240]) {
    const request = client();
    for (let index = 0; index < count; index++) {
      assert.equal(request(index % 2 ? staticPath : "/api/static-asset/chunks/app/page-a123.js"), null);
    }
    for (let index = 0; index < 20; index++) assert.equal(request("/api/explain-word-stream", "POST"), null);
    const aiLimit = request("/api/explain-word-stream", "POST");
    assert.equal(aiLimit?.status, 429);
    assert.equal(aiLimit?.headers.get("RateLimit-Limit"), "20");
    // The rejected AI request also consumes one ordinary API request, as before.
    for (let index = 0; index < 99; index++) assert.equal(request("/api/connectivity"), null);
    assert.equal(request("/api/connectivity")?.headers.get("RateLimit-Limit"), "120");
  }
});

test("static GET and HEAD share a bounded bucket, with retry metadata and per-IP isolation", async () => {
  const request = client();
  for (let index = 0; index < 600; index++) assert.equal(request(staticPath, index % 2 ? "GET" : "HEAD"), null);
  const response = request(staticPath);
  assert.equal(response?.status, 429);
  assert.equal(response?.headers.get("RateLimit-Limit"), "600");
  assert.equal(response?.headers.get("RateLimit-Remaining"), "0");
  assert.equal(response?.headers.get("Cache-Control"), "no-store");
  assert.ok(Number(response?.headers.get("Retry-After")) >= 1);
  assert.equal((await response?.json()).code, "site_rate_limit");
  assert.equal(request("/api/connectivity"), null);
  assert.equal(client()(staticPath), null);
});

test("exhausting the API bucket does not block valid encoded build paths", () => {
  const request = client();
  for (let index = 0; index < 120; index++) assert.equal(request("/api/connectivity"), null);
  assert.equal(request("/api/connectivity")?.status, 429);
  for (const path of [
    staticPath,
    "/api/static-asset/chunks/app/%5Bid%5D/page-a123.js",
    "/api/static-asset/chunks/%28group%29/%40slot/page-a123.js",
  ]) {
    assert.equal(request(path), null, path);
    assert.equal(request(path, "HEAD"), null, path);
  }
});

test("invalid static paths and non-read methods retain the ordinary API limit", () => {
  const cases: Array<[string, string]> = [
    ["/api/static-asset/", "GET"],
    ["/api/static-asset/css//file.css", "GET"],
    ["/api/static-asset/asset.json", "GET"],
    ["/api/static-asset/asset.js.br", "GET"],
    ["/api/static-asset/css/%2e%2e%2fsecret.css", "GET"],
    ["/api/static-asset/%2e%2e/secret.js", "GET"],
    ["/api/static-asset/css/%252e%252e/secret.css", "GET"],
    ["/api/static-asset/css/%5csecret.css", "GET"],
    ["/api/static-asset/css/%00file.css", "GET"],
    ["/api/static-asset/css/bad%escape.css", "GET"],
    ["/api/static-asset/css/file.css/", "GET"],
    ["/api/static-asset-other/file.css", "GET"],
    [staticPath, "POST"],
    [staticPath, "PUT"],
    [staticPath, "OPTIONS"],
  ];
  for (const [path, method] of cases) {
    const request = client();
    for (let index = 0; index < 120; index++) assert.equal(request(path, method), null, `${method} ${path}`);
    const response = request(path, method);
    assert.equal(response?.status, 429, `${method} ${path}`);
    assert.equal(response?.headers.get("RateLimit-Limit"), "120", `${method} ${path}`);
    assert.equal(request(staticPath), null);
  }
});

test("static reads preserve body bounds and mutations preserve origin protection", () => {
  const request = client();
  for (const method of ["GET", "HEAD", "POST"]) {
    assert.equal(request(staticPath, method, { "Content-Length": String(64 * 1024 + 1) })?.status, 413);
  }
  assert.equal(request(staticPath, "POST", { "Sec-Fetch-Site": "cross-site" })?.status, 403);
  assert.equal(request("/api/explain-word", "POST", { "Sec-Fetch-Site": "cross-site" })?.status, 403);
  assert.equal(request("/api/admin/homepage-curation", "PUT", { Origin: "https://invalid.example" })?.status, 403);
  assert.equal(request("/api/admin/login", "POST", { "Content-Length": String(64 * 1024 + 1) })?.status, 413);
  assert.equal(request(staticPath), null);
});

test("cold assets do not loosen the authentication and Admin route budgets", () => {
  for (const [path, limit] of [["/api/auth/phone-login", 5], ["/api/auth/phone-register", 3], ["/api/admin/login", 5]] as const) {
    const request = client();
    for (let index = 0; index < 141; index++) assert.equal(request(staticPath), null);
    for (let index = 0; index < limit; index++) assert.equal(request(path, "POST"), null);
    const response = request(path, "POST");
    assert.equal(response?.status, 429);
    assert.equal(response?.headers.get("RateLimit-Limit"), String(limit));
  }
});
