import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { LearningStorage, getLearningStorage, initializeLearningStorage, flushLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { findStandaloneDictionaryCache, recordStandaloneDictionaryCache, readStandaloneDictionaryCache, STANDALONE_DICTIONARY_CACHE_KEY } from "../lib/standaloneDictionaryCache";
import { prepareLocalAccountForUser } from "../lib/accountSyncClient";
import type { DictionaryResult } from "../types/dictionary";

function result(query: string): DictionaryResult {
  return { query, lemma:query, direction:"en_to_cn", inputStatus:"valid", phonetic:"", suggestedQuery:"",
    senses:[{partOfSpeech:"noun",meaning:"完整结果",phonetic:"",register:"",usageNote:"",exampleEnglish:"A complete example.",exampleChinese:"完整例句。"}],
    verbForms:null,usageGuide:"说明",collocations:[],synonyms:[],wordFamily:[],commonMistakes:[],memoryTip:"完整记忆" };
}
async function fixture(run: () => Promise<void>) {
  const dom = new JSDOM("", {url:"https://context-reader.com"});
  Object.defineProperty(dom.window,"indexedDB",{value:new IDBFactory()});
  Object.defineProperty(globalThis,"window",{configurable:true,value:dom.window});
  Object.defineProperty(globalThis,"CustomEvent",{configurable:true,value:dom.window.CustomEvent});
  await initializeLearningStorage(); await prepareLocalAccountForUser("A");
  try { await run(); } finally {
    await flushLearningStorage(); const storage=getLearningStorage(); if(isLearningStorage(storage))storage.close();dom.window.close();
  }
}
test("every complete result survives beyond 80 entries, cold reopen and owner archive; replay only reads its row", () => fixture(async () => {
  for(let i=0;i<1200;i++) recordStandaloneDictionaryCache(result("word"+i));
  await flushLearningStorage();
  assert.equal(readStandaloneDictionaryCache().length,1200);
  const storage=getLearningStorage(); assert.ok(isLearningStorage(storage));
  // The replay path must not decode the collection, even for a large history.
  const getItem=storage.getItem.bind(storage);
  storage.getItem=(key:string)=>{ if(key===STANDALONE_DICTIONARY_CACHE_KEY)throw Error("bulk cache read");return getItem(key); };
  const start=performance.now();
  for(let i=0;i<1000;i++) assert.equal(findStandaloneDictionaryCache("word0")?.memoryTip,"完整记忆");
  assert.ok(performance.now()-start<500,"1000 replays should not process 1200-result collections");
  storage.getItem=getItem;
  const reopened=new LearningStorage(domStorage(),window.indexedDB); await reopened.initialize();
  assert.equal(findStandaloneDictionaryCache("word0",reopened)?.senses[0].exampleChinese,"完整例句。");reopened.close();
  await prepareLocalAccountForUser("B");assert.equal(findStandaloneDictionaryCache("word0"),null);
  await prepareLocalAccountForUser("A");assert.equal(findStandaloneDictionaryCache("word0")?.query,"word0");
}));
function domStorage(){return window.localStorage;}

test("failed persistence retains every result for retry and never shrinks the result collection",()=>fixture(async()=>{
  for(let i=0;i<90;i++) recordStandaloneDictionaryCache(result("word"+i));
  const storage=getLearningStorage();assert.ok(isLearningStorage(storage));const flush=storage.flush.bind(storage);
  storage.flush=async()=>{throw Error("disk unavailable");};
  recordStandaloneDictionaryCache(result("newword"));
  await assert.rejects(flushLearningStorage());
  assert.equal(readStandaloneDictionaryCache().length,91);
  assert.equal(findStandaloneDictionaryCache("word0")?.query,"word0");
  storage.flush=flush;await flushLearningStorage();
}));
