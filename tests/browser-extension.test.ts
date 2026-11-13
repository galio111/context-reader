import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import type { User } from "@supabase/supabase-js";
// @ts-expect-error The extension's browser modules are bundled by esbuild.
import { sentenceContext, extractSelection, validWord } from "../chrome-extension/src/context.mjs";
// @ts-expect-error The extension's browser modules are bundled by esbuild.
import { normalizePreferences } from "../chrome-extension/src/preferences.mjs";
import { protectApiRequest } from "../lib/requestSecurity";
import { withExtensionUser, extensionRequestUser } from "../lib/extensionIdentity";
import { authenticateExtension, createExtensionConnection, extensionTokenHash, ExtensionAuthError } from "../lib/browserExtension";
import identity from "../chrome-extension/identity.json";
import { POST as execute } from "../app/api/extension/execute/[operation]/route";

test("selection uses the selected occurrence instead of the first repeated word", () => {
  const text = "The bank is closed. We reached the river bank before sunset. The water was cold.";
  const offset = text.lastIndexOf("bank");
  const result = sentenceContext(text, offset, offset + 4, "bank");
  assert.equal(result.sentence, "We reached the river bank before sunset.");
  assert.equal(result.previousSentence, "The bank is closed.");
  assert.equal(result.nextSentence, "The water was cold.");
});
test("scientific references and wrapped supplement labels stay in the complete sentence", () => {
  const text = "Earlier work is shown. The morphology in Fig.\nS19 explains the effect. Further study is needed.";
  const start = text.indexOf("morphology");
  assert.equal(sentenceContext(text, start, start + 10, "morphology").sentence, "The morphology in Fig.\nS19 explains the effect.");
});
test("headings containing only the word fall back to dictionary mode", () => assert.equal(sentenceContext("Perspective", 0, 11, "Perspective").sentence, ""));
test("unbounded paragraphs are not sent to the server", () => assert.equal(sentenceContext("word " + "x".repeat(6000), 0, 4, "word").sentence, ""));
test("phrase limits reject sentences, numbers and markup", () => {
  assert.equal(validWord("in spite of"), true); assert.equal(validWord("don’t"), true);
  for (const value of ["a b c d e f g h i", "<script>", "2026", "word."]) assert.equal(validWord(value), false);
});
function select(html: string, selector: string, start: number, end: number) {
  const dom = new JSDOM(html, { url: "https://example.test/article" });
  const document = dom.window.document, range = document.createRange(), node = document.querySelector(selector)!.firstChild!;
  range.setStart(node, start); range.setEnd(node, end);
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { value: () => ({ left: 20, right: 55, top: 60, bottom: 80 }) });
  document.getSelection()!.addRange(range);
  return { dom, result: extractSelection(document) };
}
test("inline markup preserves the surrounding complete sentence", () => {
  const { result, dom } = select('<p>The <b>material</b> is highly stable. It lasts.</p>', "b", 0, 8);
  assert.equal(result.word, "material"); assert.equal(result.sentence, "The material is highly stable."); assert.equal(result.nextSentence, "It lasts."); dom.window.close();
});
test("hidden and script text are excluded from model context", () => {
  const { result, dom } = select('<p>The <i hidden>private secret</i><b>material</b><script>password</script> is stable.</p>', "b", 0, 8);
  assert.equal(result.sentence, "The material is stable."); dom.window.close();
});
test("editable text is not collected", () => {
  const { result, dom } = select('<div contenteditable="true"><b>material</b> is private.</div>', "b", 0, 8);
  assert.equal(result, null); dom.window.close();
});
test("read-only contenteditable=false remains queryable", () => {
  const { result, dom } = select('<p contenteditable="false"><b>material</b> is stable.</p>', "b", 0, 8);
  assert.equal(result.sentence, "material is stable."); dom.window.close();
});
test("preferences bound window size and reject injected CSS", () => {
  const p = normalizePreferences({ width: -99, height: Infinity, opacity: 1000, background: "red;display:none", text: "#111111", autoLookup: "true" });
  assert.equal(p.width, 300); assert.equal(p.height, 520); assert.equal(p.opacity, 100); assert.equal(p.background, "#ffffff"); assert.equal(p.text, "#111111"); assert.equal(p.autoLookup, false);
});
test("extension identity is stable and matches the package public key", async () => {
  const { createHash } = await import("node:crypto");
  const id = [...createHash("sha256").update(Buffer.from(identity.key,"base64")).digest().subarray(0,16)].map(v => String.fromCharCode(97+(v>>4),97+(v&15))).join("");
  assert.equal(id, identity.id);
});
test("only the exact extension origin can use the cross-site execution exception", () => {
  const request = (path: string, origin: string) => new Request(`https://context-reader.com${path}`, { method: "POST", headers: { origin, "sec-fetch-site": "cross-site" } });
  const origin = `chrome-extension://${identity.id}`;
  assert.equal(protectApiRequest(request("/api/extension/execute/explain", origin)), null);
  assert.equal(protectApiRequest(request("/api/extension/connections", origin))?.status, 403);
  assert.equal(protectApiRequest(request("/api/admin/accounts", origin))?.status, 403);
  assert.equal(protectApiRequest(request("/api/extension/execute/explain", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))?.status, 403);
  assert.equal(protectApiRequest(request("/api/extension/execute/save", "https://malicious.test"))?.status, 403);
});
test("simultaneous extension accounts have separate async identities", async () => {
  const user = (id: string) => ({ id }) as User;
  const result = await Promise.all([withExtensionUser(user("A"), async () => { await new Promise(r => setTimeout(r,20)); return extensionRequestUser()?.id; }), withExtensionUser(user("B"), async () => { await new Promise(r => setTimeout(r,5)); return extensionRequestUser()?.id; })]);
  assert.deepEqual(result, ["A","B"]); assert.equal(extensionRequestUser(), undefined);
});
test("missing and malformed connection tokens fail before database access", async () => {
  for (const token of ["", "Bearer anything", "Bearer crx_short"]) await assert.rejects(authenticateExtension(new Request("https://context-reader.com", { headers: { authorization: token } })), ExtensionAuthError);
});
test("connection storage contains only a digest, expiry and owner", async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, original = globalThis.fetch;
  process.env.SUPABASE_URL = "https://account.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
  let stored: any;
  globalThis.fetch = async (_url, init) => { stored = JSON.parse(String(init?.body)); return new Response(null, { status: 201 }); };
  try { const result = await createExtensionConnection("owner-A", "Mac Chrome"); assert.equal(stored.user_id, "owner-A"); assert.equal(stored.token_hash, extensionTokenHash(result.token)); assert.ok(!JSON.stringify(stored).includes(result.token)); assert.ok(Date.parse(stored.expires_at) > Date.now() + 89 * 86400000); }
  finally { globalThis.fetch = original; if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; }
});
test("database migration denies browser roles and enables RLS", () => {
  const sql = readFileSync("ops/mainland/extension-connections.sql", "utf8"); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all.*from anon, authenticated/); assert.match(sql, /references auth.users/);
});

test("save uses the connection owner, preserves an existing id and Anki record, and writes through CAS", async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, original = globalThis.fetch;
  process.env.SUPABASE_URL = "https://account.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key-not-a-real-secret";
  const owner = "11111111-1111-4111-8111-111111111111";
  const context = { word: "bank", sentence: "The river bank is quiet.", previousSentence: "", nextSentence: "" };
  const explanation = { word: "bank", lemma: "bank", phonetic: "/bæŋk/", phoneticFor: "bank", partOfSpeech: "名词", basicMeaning: "银行；河岸", contextMeaning: "这里指河岸", sentenceTranslation: "河岸很安静。", usageNote: "名词", collocation: "river bank（河岸）", exampleEnglish: "The bank is quiet.", exampleChinese: "河岸很安静。", difficulty: "easy", shouldAddToVocabulary: true, anki: {} };
  let saved: any, revoked = false;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.includes("browser_extension_connections?")) return Response.json(revoked ? [] : [{ id: "22222222-2222-4222-8222-222222222222", user_id: owner }]);
    if (path.includes("account_profiles?")) return Response.json([{ status: "active", nickname: "Owner A" }]);
    if (path.includes("/auth/v1/admin/users/")) return Response.json({ user: { id: owner, aud: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } });
    if (path.includes("user_data_objects?")) return Response.json([{ object_key: "original-word-id", server_version: 9, payload: { ...explanation, createdAt: "2020-01-01T00:00:00Z", anki: { ankiNoteId: 123, ankiImportedAt: "2021-01-01T00:00:00Z" } } }]);
    if (path.endsWith("rpc/merge_user_data_objects")) { saved = JSON.parse(String(init?.body)); const object = saved.p_objects[0]; return Response.json([{ kind: "vocabulary", object_key: object.objectKey, payload: object.payload, client_updated_at: object.clientUpdatedAt, server_version: 10, accepted: true }]); }
    throw new Error("Unexpected mocked endpoint");
  };
  const request = () => new Request("https://context-reader.com/api/extension/execute/save", { method: "POST", headers: { authorization: "Bearer crx_" + "x".repeat(43), "Content-Type": "application/json" }, body: JSON.stringify({ context, explanation, userId: "attacker-requested-owner-B" }) });
  try {
    const response = await execute(request(), { params: Promise.resolve({ operation: "save" }) }); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(saved.p_user_id, owner); assert.equal(saved.p_objects[0].objectKey, "original-word-id"); assert.equal(saved.p_objects[0].serverVersion, 9);
    assert.equal(saved.p_objects[0].payload.createdAt, "2020-01-01T00:00:00Z"); assert.equal(saved.p_objects[0].payload.anki.ankiNoteId, 123); assert.equal(saved.p_objects[0].payload.contextMeaning, "这里指河岸");
    revoked = true; saved = null; const denied = await execute(request(), { params: Promise.resolve({ operation: "save" }) }); assert.equal(denied.status, 401); assert.equal(saved, null);
  } finally { globalThis.fetch = original; if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; }
});
