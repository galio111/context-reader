import test from "node:test";
import assert from "node:assert/strict";
import { protectApiRequest } from "../lib/requestSecurity";

const base = "https://context-reader.com";
const request = (path: string, bytes: number, origin = base) => new Request(base + path, {
  method: "PUT", headers: { Origin: origin, "Content-Length": String(bytes) },
});

test("real catalogue-sized curation passes the middleware body guard", () => {
  assert.equal(protectApiRequest(request("/api/admin/homepage-curation", 146_000)), null);
});

test("curation remains bounded and other Admin limits stay small", () => {
  assert.equal(protectApiRequest(request("/api/admin/homepage-curation", 1024 * 1024 + 1))?.status, 413);
  assert.equal(protectApiRequest(request("/api/admin/login", 146_000))?.status, 413);
});

test("large curation mutations still reject a foreign origin", () => {
  assert.equal(protectApiRequest(request("/api/admin/homepage-curation", 146_000, "https://invalid.example"))?.status, 403);
});
