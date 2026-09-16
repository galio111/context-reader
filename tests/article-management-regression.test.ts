import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { getLearningStorage, initializeLearningStorage, flushLearningStorage } from "../lib/learningStorage";
import { writeStoredArticles } from "../lib/articleStorage";
import { getSavedArticles, renameSavedArticle, deleteSavedArticle } from "../lib/articles";

test("article rename and deletion persist without removing an unrelated article", async () => {
 const original = Object.getOwnPropertyDescriptor(globalThis, "window");
 const originalEvent = globalThis.CustomEvent;
 const dom = new JSDOM("", { url: "https://context-reader.com" });
 Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
 Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
 globalThis.CustomEvent = dom.window.CustomEvent as typeof CustomEvent;
 try {
  await initializeLearningStorage();
  const at = new Date().toISOString();
  writeStoredArticles(getLearningStorage(), [
   {id:"qa-one", title:"Old title", body:"The first article describes furniture markets.",summary:"",createdAt:at,updatedAt:at,lastOpenedAt:at},
   {id:"qa-two", title:"Keep me", body:"A second unrelated article concerns ocean wildlife.",summary:"",createdAt:at,updatedAt:at,lastOpenedAt:at},
  ]);
  renameSavedArticle("qa-one", "Renamed title");
  await flushLearningStorage();
  assert.equal(getSavedArticles().find(a=>a.id==="qa-one")?.title,"Renamed title");
  deleteSavedArticle("qa-one");
  await flushLearningStorage();
  assert.deepEqual(getSavedArticles().map(a=>a.id),["qa-two"]);
  const db = await new Promise<IDBDatabase>((resolve,reject)=>{const r=dom.window.indexedDB.open("context-reader-learning-v1");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const rows = await new Promise<any[]>((resolve,reject)=>{const r=db.transaction("records").objectStore("records").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  assert.equal(rows.some(r=>r.bucket==="context-reader:articles:v1"&&r.id==="qa-one"),false);
  assert.equal(rows.some(r=>r.bucket==="context-reader:articles:v1"&&r.id==="qa-two"),true);
  db.close();
 } finally {
  if(original)Object.defineProperty(globalThis,"window",original);else Reflect.deleteProperty(globalThis,"window");
  globalThis.CustomEvent=originalEvent;dom.window.close();
 }
});
