import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as scheduler from "../lib/studyScheduler";
import * as transport from "../lib/studyTransport";
import { transportFixture } from "./fixtures/study-transport-fixture";
import type { VocabularyEntry } from "../types/vocabulary";

function harness() {
  const snapshot = transportFixture(), reads: string[] = [], writes: string[] = [];
  let authenticated = true, active = true, missing = false;
  const savedEntry = { ...snapshot.entries[0], dictionaryResult: { query: "saved result" } } as VocabularyEntry;
  const accountFetch = async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push(path);
    reads.push(path);
    if (path.startsWith("account_profiles?")) return [{ status: active ? "active" : "disabled" }];
    if (path.startsWith("user_data_objects?")) return missing ? [] : [{ object_key: savedEntry.id, payload: savedEntry }];
    if (path.startsWith("study_settings?")) return [{ settings: scheduler.DEFAULT_STUDY_SETTINGS }];
    if (path.startsWith("study_days?")) return [{ day: "2026-10-13", completed_at: null }];
    throw Error("unexpected account read: " + path);
  };
  function load(file: string, imports: Record<string, unknown>) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (key: string) => { if (key in imports) return imports[key]; throw Error(key); }, Date, Set, Map, URL, URLSearchParams, console, encodeURIComponent });
    return module.exports as typeof import("../lib/studyStore") & typeof import("../app/api/study/route");
  }
  const store = load("lib/studyStore.ts", { "server-only": {}, "node:crypto": { createHash }, "@/lib/accountStore": { accountFetch }, "@/lib/studyScheduler": scheduler });
  const route = load("app/api/study/route.ts", {
    "next/server": { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } },
    "@/lib/accountStore": { accountFetch }, "@/lib/userAuth": { getAuthenticatedUser: async () => authenticated ? { id: "owner" } : null },
    "@/lib/requestSecurity": { requestExternalOrigin: () => "https://context-reader.com" },
    "@/lib/limitedBody": { readJsonBody: (r: Request) => r.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/studyScheduler": scheduler, "@/lib/studyTransport": transport,
    "@/lib/studyStore": { ...store, getStudySnapshot: async () => snapshot, reconcileStudyCards: async () => snapshot.entries, studyRpc: async () => ({ saved: true }) },
    "@/lib/serverErrorReporting": { recordServerError: async () => {} },
  });
  const get = (query = "", headers = {}) => route.GET(new Request("https://context-reader.com/api/study" + query, { headers: { "X-Context-Account": "owner", ...headers } }));
  return { get, route, snapshot, reads, writes, savedEntry, auth: (value: boolean) => { authenticated = value; }, active: (value: boolean) => { active = value; }, missing: (value: boolean) => { missing = value; } };
}

test("compact response opt-in handles GET and nested mutations without changing legacy snapshots", async () => {
  const h = harness();
  const legacy = await h.get();
  assert.equal((await legacy.json()).entries[19].usageNote, h.snapshot.entries[19].usageNote);
  const compact = await h.get("", { "X-Study-Format": "compact-v1" });
  assert.equal((await compact.json()).entries[19].studySummary, true);
  assert.equal(compact.headers.get("cache-control"), "private, no-store");
  assert.ok(compact.headers.get("vary")?.includes("X-Study-Format"));
  const complete = await h.route.POST(new Request("https://context-reader.com/api/study", { method: "POST", headers: { Origin: "https://context-reader.com", "X-Context-Account": "owner", "X-Study-Format": "compact-v1", "Content-Type": "application/json" }, body: JSON.stringify({ op: "complete" }) }));
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).snapshot.entries[19].studySummary, true);
});

test("single-entry detail is an owner-scoped saved-result read including its dictionary, with no writes", async () => {
  const h = harness(), response = await h.get("?entry=entry-0", { "X-Study-Format": "compact-v1" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entry, h.savedEntry);
  const dataReads = h.reads.filter(path => path.startsWith("user_data_objects?"));
  assert.equal(dataReads.length, 1);
  const query = new URLSearchParams(dataReads[0].split("?")[1]);
  assert.equal(query.get("user_id"), "eq.owner");
  assert.equal(query.get("object_key"), "eq.entry-0");
  assert.equal(query.get("kind"), "eq.vocabulary");
  assert.equal(query.get("deleted_at"), "is.null");
  assert.equal(query.get("limit"), "1");
  assert.deepEqual(h.writes, []);
  h.missing(true);
  const missing = await h.get("?entry=entry-0");
  assert.equal(missing.status, 404); assert.equal((await missing.json()).code, "state_changed");
});

test("reminders fetch only settings and today's completion, without full plan or vocabulary data", async () => {
  const h = harness(), response = await h.get("?summary=1");
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.settings.reminders, true);
  assert.deepEqual(summary.today, { day: "2026-10-13", completed_at: null });
  assert.equal(h.reads.length, 3, "one profile guard and two small reminder reads");
  assert.ok(h.reads.some(path => path.includes("select=day,completed_at")));
  assert.deepEqual(h.writes, []);
});

test("detail and reminder routes retain login, expected-owner and active-profile authorization", async () => {
  for (const query of ["?entry=entry-0", "?summary=1"]) {
    const h = harness(); h.auth(false);
    assert.equal((await h.get(query)).status, 401); assert.equal(h.reads.length, 0);
    h.auth(true);
    assert.equal((await h.get(query, { "X-Context-Account": "other" })).status, 409); assert.equal(h.reads.length, 0);
    h.active(false);
    assert.equal((await h.get(query)).status, 403); assert.equal(h.reads.length, 1);
    assert.deepEqual(h.writes, []);
  }
});
