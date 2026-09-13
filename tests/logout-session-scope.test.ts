import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test("ordinary logout revokes only its own session and clears this browser cookies", async t => {
  const require = createRequire(import.meta.url);
  const localPath = require.resolve("../lib/localDeveloper.ts");
  require.cache[localPath] = { id: localPath, filename: localPath, loaded: true, exports: { getLocalDeveloperUser: async () => null, isLocalDeveloperEnvironment: () => false } } as NodeModule;
  const { signOutAuthenticatedUser } = require("../lib/userAuth.ts");
  t.after(() => { delete require.cache[localPath]; });
  const headerModule = require("next/headers");
  const removed: string[] = [];
  t.mock.method(headerModule, "cookies", async () => ({ get: (name: string) => ({ value: name === "context_reader_access" ? "own-access-token" : "own-refresh-token" }), set: (name: string, value: string, options: { maxAge: number }) => { assert.equal(value, ""); assert.equal(options.maxAge, 0); removed.push(name); } }));
  const oldURL = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://logout-test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key-".repeat(4);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => { const url = new URL(String(input)); requests.push(url.pathname); assert.equal(url.searchParams.get("scope"), "local"); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer own-access-token"); return new Response(null, { status: 204 }); };
  try { await signOutAuthenticatedUser(); assert.deepEqual(requests, ["/auth/v1/logout"]); assert.deepEqual(removed, ["context_reader_access", "context_reader_refresh"]); }
  finally { globalThis.fetch = originalFetch; if (oldURL === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldURL; if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; }
});
