import test from "node:test";
import assert from "node:assert/strict";
import { writeSyncObjects } from "../lib/accountStore";
import { cleanDocumentArticlePayload, preserveDocumentArticlePayload } from "../lib/documentArticleSync";
import { cleanDocumentText } from "../lib/documentUnicode";
import { normalizeDocumentSelection } from "../lib/documentSelection";
import { mergeDuplicateSavedArticles } from "../lib/savedArticleMerge";
import type { SavedArticle } from "../types/article";

const importedArticle = { title: "Original", url: "", siteName: "PDF", text: "Original body", blocks: [{ id: "doc-p1-b0", type: "paragraph", text: "Original body" }], document: { id: "a".repeat(64), format: "pdf", name: "source.pdf", pageCount: 1 } };
const original = { id: "article-one", body: "Original body", title: "Original", summary: "", createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", importedArticle } as SavedArticle;
test("PDF hidden Unicode cannot break JSONB persistence and meaningful Unicode survives", () => {
  const text = "hydro\u0000gel α β 中文 𝛼 😀 \ud800 / \udc00";
  const expected = "hydrogel α β 中文 𝛼 😀 � / �";
  assert.equal(cleanDocumentText(text), expected);
  assert.equal(normalizeDocumentSelection("hydro\u0000gel"), "hydrogel");
  const input = { ...original, body: text, importedArticle: { ...importedArticle, text, blocks: [{ ...importedArticle.blocks[0], text }] } };
  const cleaned = cleanDocumentArticlePayload(input) as SavedArticle;
  assert.equal(cleaned.body, expected);
  assert.equal(cleaned.importedArticle!.blocks![0].text, expected);
  assert.deepEqual(cleaned.importedArticle!.document, importedArticle.document);
  assert.equal(input.body, text, "does not mutate the pending local original");
  const ordinary = { body: text };
  assert.equal(cleanDocumentArticlePayload(ordinary), ordinary);
});

test("document source survives older-client metadata and richer duplicate saves", () => {
  const older = { ...original, title: "Renamed", summary: "Long summary ".repeat(100), importedArticle: { ...importedArticle, document: undefined, blocks: [{ ...importedArticle.blocks[0], id: "block-0" }] } } as SavedArticle;
  const protectedValue = preserveDocumentArticlePayload(older, original) as SavedArticle;
  assert.equal(protectedValue.title, "Renamed"); assert.equal(protectedValue.summary, older.summary);
  assert.deepEqual(protectedValue.importedArticle, importedArticle);
  const merged = mergeDuplicateSavedArticles([older, original]).articles[0];
  assert.deepEqual(merged.importedArticle, importedArticle); assert.equal(merged.summary, older.summary);
  assert.equal(preserveDocumentArticlePayload(older, { body: "ordinary" }), older);
});

test("server protects only the owner document and retains CAS versions and tombstones", async () => {
  const nativeFetch = globalThis.fetch, env = { ...process.env }; const calls: Array<{ url: string; body?: any }> = [];
  process.env.SUPABASE_URL = "https://database.example"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ url, body });
    if (!body) return Response.json([{ object_key: original.id, payload: original }]);
    return Response.json(body.p_objects.map((o: any) => ({ kind: o.kind, object_key: o.objectKey, payload: o.payload, client_updated_at: o.clientUpdatedAt, server_version: o.serverVersion, deleted_at: o.deletedAt, accepted: false })));
  };
  try {
    const input = [{ kind: "article" as const, objectKey: original.id, payload: { ...original, importedArticle: undefined }, clientUpdatedAt: original.updatedAt, serverVersion: 7 }];
    const result = await writeSyncObjects("owner-one", input);
    assert.equal(new URL(calls[0].url).searchParams.get("user_id"), "eq.owner-one");
    assert.equal(new URL(calls[0].url).searchParams.get("payload->importedArticle->document"), "not.is.null");
    assert.equal(calls[1].body.p_objects[0].serverVersion, 7);
    assert.deepEqual(calls[1].body.p_objects[0].payload.importedArticle, importedArticle);
    assert.equal(result[0].accepted, false, "a concurrent CAS rejection stays rejected");
    calls.length = 0;
    await writeSyncObjects("owner-one", [{ ...input[0], deletedAt: original.updatedAt }]);
    assert.equal(calls.length, 1); assert.equal(calls[0].body.p_objects[0].deletedAt, original.updatedAt);
    calls.length = 0;
    await writeSyncObjects("owner-one", [{ ...input[0], objectKey: "new-document", serverVersion: 0,
      payload: { ...original, id: "new-document", body: "hydro\u0000gel", importedArticle: { ...importedArticle, text: "hydro\u0000gel" } } }]);
    assert.equal(calls[1].body.p_objects[0].payload.body, "hydrogel", "clean before JSONB RPC");
    assert.equal(calls[1].body.p_objects[0].payload.importedArticle.text, "hydrogel");
    assert.equal(calls[1].body.p_objects[0].serverVersion, 0);
  } finally { globalThis.fetch = nativeFetch; process.env = env; }
});
