import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { emptyUiDesignState, publicUiDesignState, UiDesignValidationError } from "../lib/uiDesign";

const state = emptyUiDesignState();
const mockState = {
  access: "developer" as string | null, reads: 0, writes: 0,
  result: { state, status: "saved" },
  error: null as Error | null,
};
Object.assign(globalThis, { __uiDesignApiTest: mockState });
const authUrl = pathToFileURL(path.join(process.cwd(), "tests", "fixtures", "ui-design-auth.cjs")).href;
const storeUrl = pathToFileURL(path.join(process.cwd(), "tests", "fixtures", "ui-design-store.cjs")).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/adminAuth") return { url: authUrl, shortCircuit: true };
    if (specifier === "@/lib/uiDesignStore") return { url: storeUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
let admin: typeof import("../app/api/admin/ui-design/route");
let publicRoute: typeof import("../app/api/ui-design/route");
before(async () => {
  admin = await import("../app/api/admin/ui-design/route");
  publicRoute = await import("../app/api/ui-design/route");
});
after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, "__uiDesignApiTest"); });
const origin = "https://context-reader.com";
function request(body = '{"action":"publish","expectedRevision":0}', headers: Record<string, string> = {}) {
  return new Request(origin + "/api/admin/ui-design", { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body });
}

test("admin UI access requires a server-verified developer and excludes legacy password sessions", async () => {
  for (const access of [null, "password"]) {
    mockState.access = access;
    assert.equal((await admin.GET()).status, 403);
    assert.equal((await admin.POST(request())).status, 403);
  }
  assert.equal(mockState.reads, 0);
  assert.equal(mockState.writes, 0);
  mockState.access = "developer";
  const response = await admin.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("cross-origin, missing-origin, oversized and malformed writes never call persistence", async () => {
  mockState.writes = 0;
  assert.equal((await admin.POST(request(undefined, { origin: "https://attacker.test" }))).status, 403);
  assert.equal((await admin.POST(request(undefined, { origin: "" }))).status, 403);
  assert.equal((await admin.POST(request(undefined, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await admin.POST(request(undefined, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await admin.POST(request("not json"))).status, 400);
  assert.equal((await admin.POST(request("x".repeat(65_537)))).status, 413);
  assert.equal(mockState.writes, 0);
});

test("save conflicts return the latest saved state and never pretend success", async () => {
  mockState.result = { status: "conflict", state: { ...state, revision: 4 } };
  const response = await admin.POST(request());
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.code, "conflict");
  assert.equal(data.state.revision, 4);
  mockState.result = { status: "no-previous", state };
  assert.equal((await admin.POST(request())).status, 409);
  mockState.result = { status: "saved", state };
});

test("validation messages are bounded product copy, while transport faults stay private", async () => {
  mockState.error = new UiDesignValidationError("请选择有效的颜色。");
  let response = await admin.POST(request());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "请选择有效的颜色。");
  mockState.error = new Error("postgres credentials secret@private.internal");
  const log = console.error;
  console.error = () => undefined;
  try {
    response = await admin.POST(request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret|postgres|internal/);
    response = await publicRoute.GET();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret|postgres|internal/);
  } finally { console.error = log; mockState.error = null; }
});

test("public endpoint exposes only the published projection, without draft, history or admin checks", async () => {
  mockState.access = null;
  mockState.result = { status: "saved", state: { ...state, draft: { version: 1, targets: { "private-draft": { accent: "#ff0000" } } } } };
  const response = await publicRoute.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), publicUiDesignState(state));
});
