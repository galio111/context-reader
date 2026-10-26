import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { User } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
test("saved sessions: encrypted, bounded to three, deduplicated, rotated, removable and tamper resistant", async t => {
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret".repeat(4);
  const jar = new Map<string, string>();
  let requestJar = jar;
  const writtenNames: string[] = [];
  t.mock.method(require("next/headers"), "cookies", async () => ({
    get: (name: string) => requestJar.has(name) ? { value: requestJar.get(name) } : undefined,
    set: (name: string, value: string, options: { httpOnly: boolean; sameSite: string; maxAge: number }) => {
      writtenNames.push(name);
      assert.equal(options.httpOnly, true); assert.equal(options.sameSite, "lax");
      if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
    },
  }));
  t.after(() => { if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; });
  const { rememberSavedSession, listSavedAccounts, savedSessionSlots, forgetSavedAccount, decodeSavedSession, forgetSavedRefreshToken } = require("../lib/savedAccountSessions.ts");
  const user = (id: string) => ({ id, user_metadata: { nickname: id, phone: "13800000000" } }) as unknown as User;
  for (const id of ["a", "b", "c"]) await rememberSavedSession(user(id), `refresh-${id}`);
  assert.equal([...jar.keys()].filter(k => k.startsWith("context_reader_saved_")).length, 3);
  assert.equal((await listSavedAccounts()).length, 3);
  for (const value of jar.values()) { assert.ok(!value.includes("refresh-")); assert.ok(value.length < 3800); }
  assert.ok(!JSON.stringify(await listSavedAccounts()).includes("refresh"));
  await rememberSavedSession(user("a"), "rotated-a");
  assert.equal([...jar.keys()].filter(k => k.startsWith("context_reader_saved_")).length, 3);
  assert.equal((await savedSessionSlots())[0].session.refreshToken, "rotated-a");
  await assert.rejects(rememberSavedSession(user("d"), "refresh-d"), /三个/);
  assert.deepEqual((await listSavedAccounts()).map((a: {userId: string}) => a.userId), ["a", "b", "c"]);
  const oldRequestCookies = new Map(jar);
  await forgetSavedAccount("b"); await rememberSavedSession(user("d"), "refresh-d");
  await forgetSavedRefreshToken("refresh-c");
  assert.deepEqual((await listSavedAccounts()).map((a: {userId: string}) => a.userId), ["a", "d"]);
  requestJar = oldRequestCookies; writtenNames.length = 0;
  await rememberSavedSession(user("b"), "late-refresh-b");
  assert.deepEqual(writtenNames, ["context_reader_saved_b"], "late refresh never changes the roster or another user's cookie");
  requestJar = jar;
  assert.deepEqual((await listSavedAccounts()).map((a: {userId: string}) => a.userId), ["a", "d"]);
  const { readTokens } = require("../lib/userAuth.ts");
  jar.set("context_reader_access", "legacy-other-account");
  jar.set("context_reader_refresh", "legacy-other-refresh");
  jar.set("context_reader_active_account", "d");
  assert.equal((await readTokens()).refreshToken, "refresh-d", "selected account overrides legacy cookies");
  await forgetSavedAccount("d");
  assert.deepEqual(await readTokens(), { accessToken: "", refreshToken: "" }, "missing selection never falls back to a different identity");
  const encoded = jar.get("context_reader_saved_a")!;
  const bytes = Buffer.from(encoded, "base64url"); bytes[30] ^= 1;
  assert.equal(decodeSavedSession(bytes.toString("base64url")), null);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "different-secret";
  assert.equal(decodeSavedSession(encoded), null);
});
