import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {IDBFactory} from "fake-indexeddb";
import {initializeLearningStorage,getLearningStorage,flushLearningStorage,isLearningStorage} from "../lib/learningStorage";
import {prepareLocalAccountForUser,syncAccountData} from "../lib/accountSyncClient";
import {recordStandaloneDictionaryHistory,removeStandaloneDictionaryHistory,readStandaloneDictionaryHistory,beginDictionaryQuery} from "../lib/standaloneDictionaryHistory";
import type {AccountSyncObject} from "../types/account";
test('dictionary delete and explicit requery survive actual protocol-2 bootstrap, stale data and two devices',async()=>{
 const originalFetch=globalThis.fetch,devices:JSDOM[]=[];
 const cloud=new Map<string,AccountSyncObject>();const writes:AccountSyncObject[]=[];
 globalThis.fetch=async(input,init)=>{
  if(init?.method==='POST'){
   const incoming=JSON.parse(String(init.body)).objects as AccountSyncObject[];writes.push(...incoming);
   const results=incoming.map(o=>({...o,serverVersion:(cloud.get(`${o.kind}:${o.objectKey}`)?.serverVersion || 0)+1,accepted:true}));results.forEach(o=>cloud.set(`${o.kind}:${o.objectKey}`,o));return Response.json({objects:results});
  }
  const params=new URL(String(input),'https://context-reader.com').searchParams;
  if(!params.has('bootstrap'))return Response.json({objects:[...cloud.values()],nextCursor:'current',hasMore:false});
  const learning=new Set(['article','vocabulary','reading_state']);const rows=[...cloud.values()].filter(o=>Boolean(o.deletedAt)===(params.get('bootstrap')==='deleted') && learning.has(o.kind)===(params.get('group')==='learning'));
  return Response.json({objects:rows,nextOffset:null,snapshotCursor:'current'});
 };
 const select=async(device?:JSDOM)=>{const dom=device || new JSDOM('',{url:'https://context-reader.com'});if(!device){devices.push(dom);Object.defineProperty(dom.window,'indexedDB',{value:new IDBFactory()});}Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'CustomEvent',{configurable:true,value:dom.window.CustomEvent});await initializeLearningStorage();await prepareLocalAccountForUser('A');return dom;};
 try {
  const first=await select();recordStandaloneDictionaryHistory('我崩溃了');await flushLearningStorage();await syncAccountData();
  const second=await select();await syncAccountData();assert.equal(readStandaloneDictionaryHistory().length,1);
  const stale=beginDictionaryQuery('我崩溃了');
  await select(first);await removeStandaloneDictionaryHistory('我崩溃了');await syncAccountData();
  await select(second);recordStandaloneDictionaryHistory('我崩溃了',stale);await syncAccountData();await syncAccountData();
  assert.equal(readStandaloneDictionaryHistory().length,0);
  recordStandaloneDictionaryHistory('我崩溃了');await syncAccountData();await syncAccountData();assert.equal(readStandaloneDictionaryHistory().length,1);
  await select(first);await syncAccountData();assert.equal(readStandaloneDictionaryHistory().length,1);
  await syncAccountData();assert.equal(readStandaloneDictionaryHistory().length,1);
 } finally {globalThis.fetch=originalFetch;const storage=getLearningStorage();if(isLearningStorage(storage))storage.close();devices.forEach(d=>d.window.close());}
});
