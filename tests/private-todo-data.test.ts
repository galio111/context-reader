import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { isPrivateTodoState, type PrivateTodoState } from "../lib/privateTodoState";
import { readPrivateTodo, updatePrivateTodo } from "../lib/privateTodoStore";
import { protectApiRequest } from "../lib/requestSecurity";

const state: PrivateTodoState = {
  version: 1, tasks: [], history: [], categories: ["课程"], settings: { emailEnabled: false, emailAddress: "",
    learnDefaults: true, defaultMissed: "skip", remindMinutes: 60, allDayTime: "18:00" },
};

test("private todo writes validate real dates, unique occurrences and a single reminder recipient", () => {
  const task = { id: "t", title: "课程", category: "课程", date: "2028-02-29", time: "23:00", created: "2026-11-24",
    daily: true, missed: "carry", skippedDates: ["2028-03-02"], priority: "", lead: 0 };
  const completion = { key: "t@2028-03-01", occ: "2028-03-01", taskId: "t", title: "课程", category: "课程", daily: true, finished: 1 };
  assert.ok(isPrivateTodoState({ ...state, tasks: [task], history: [completion] }));
  assert.ok(isPrivateTodoState({ ...state, history: [{ ...completion, importedWithoutCompletionDate: true }] }));
  assert.equal(isPrivateTodoState({ ...state, history: [{ ...completion, importedWithoutCompletionDate: "yes" }] }), false);
  for (const bad of [{ ...task, date: "2026-02-29" }, { ...task, time: "25:00" }, { ...task, missed: "unknown" },
    { ...task, skippedDates: ["2028-02-30"] }]) assert.equal(isPrivateTodoState({ ...state, tasks: [bad] }), false);
  assert.equal(isPrivateTodoState({ ...state, history: [completion, completion] }), false);
  assert.equal(isPrivateTodoState({ ...state, history: [{ ...completion, key: "t@once" }] }), false);
  for (const address of ["", "a@example.com,other@example.com", "Name <a@example.org>", "a@example.com\r\nBcc:b@example.com"]) {
    assert.equal(isPrivateTodoState({ ...state, settings: { ...state.settings, emailEnabled: true, emailAddress: address } }), false);
  }
  assert.ok(isPrivateTodoState({ ...state, settings: { ...state.settings, emailEnabled: true, emailAddress: "abc+test@example.org" } }));
});

test("todo store scopes reads and compare-and-set writes to a single owner and revision", async t => {
  const previousUrl = process.env.SUPABASE_URL, previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "http://127.0.0.1"; process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  let revision = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(init.cache, "no-store"); assert.equal(url.pathname, "/rest/v1/personal_todo_workspace");
    if (url.searchParams.get("owner_id") !== "eq.owner") return Response.json([]);
    if (init.method === "PATCH") {
      if (url.searchParams.get("revision") !== "eq." + revision) return Response.json([]);
      const json = JSON.parse(String(init.body));
      assert.equal(json.revision, revision + 1); revision++;
    }
    return Response.json([{ revision, state }]);
  });
  assert.equal((await readPrivateTodo("owner"))?.revision, 0);
  assert.equal((await updatePrivateTodo("owner", 0, state))?.revision, 1);
  assert.equal(await updatePrivateTodo("owner", 0, state), null);
  assert.equal(await readPrivateTodo("other"), null);
  assert.equal(await updatePrivateTodo("other", 1, state), null);
});

test("private todo paths bypass the PWA navigation cache and deny foreign-origin changes", () => {
  let handler: (event: {request: Request}) => void = () => { throw new Error("no handler") };
  const self = { location: { origin: "https://context-reader.com" }, addEventListener(name: string, fn: typeof handler) { if (name === "fetch") handler = fn; } };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, URL });
  for (const route of ["/todo", "/todo/?from=bookmark", "/api/todo", "/api/todo/parse"]) {
    handler({ request: { url: "https://context-reader.com" + route, method: "GET", mode: "navigate" } as Request });
  }
  for (const route of ["/api/todo", "/api/todo/parse"]) {
    const req = new Request("https://context-reader.com" + route, { method: "POST", headers: { Origin: "https://other.example" } });
    assert.equal(protectApiRequest(req)?.status, 403);
  }
});
