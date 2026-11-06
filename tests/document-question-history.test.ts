import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { documentQuestionScope, readDocumentQuestions, saveDocumentQuestion } from "../lib/documentQuestionHistory";

test("paper histories survive reopen, isolate accounts and documents, and retain concurrent appends", async () => {
  Object.assign(globalThis, { indexedDB: new IDBFactory() });
  const a = documentQuestionScope("account-a", "pdf-1");
  const b = documentQuestionScope("account-a", "pdf-2");
  const c = documentQuestionScope("account-b", "pdf-1");
  const turn = (id: string) => ({id,createdAt:`2026-11-06T00:00:0${id}Z`,question:`Question ${id}`,answer:`Answer ${id}`,sources:[{title:"Reference",url:"https://example.org"}]});
  await Promise.all([saveDocumentQuestion(a,turn("1")),saveDocumentQuestion(a,turn("2")),saveDocumentQuestion(b,turn("3")),saveDocumentQuestion(c,turn("4"))]);
  assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["1","2"]);
  assert.deepEqual((await readDocumentQuestions(b)).map(t=>t.id),["3"]);
  assert.deepEqual((await readDocumentQuestions(c)).map(t=>t.id),["4"]);
  assert.deepEqual(await readDocumentQuestions(documentQuestionScope("account-c","pdf-1")),[]);
  await saveDocumentQuestion(a,turn("1"));
  assert.equal((await readDocumentQuestions(a)).length,2,"retry of same turn must not duplicate history");
  assert.equal((await readDocumentQuestions(a))[0].sources?.[0].title,"Reference");
});

test("scope uses unambiguous identities", () => {
  assert.notEqual(documentQuestionScope("a:b","c"),documentQuestionScope("a","b:c"));
});
