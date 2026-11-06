import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { initializeLearningStorage,getLearningStorage,isLearningStorage } from "../lib/learningStorage";
import { prepareLocalAccountForUser,syncAccountData } from "../lib/accountSyncClient";
import { documentQuestionScope,documentQuestionObjectKey,normalizeDocumentQuestionRecord,readDocumentQuestions,saveDocumentQuestion,mergeDocumentQuestionObjects } from "../lib/documentQuestionHistory";
import type { AccountSyncObject } from "../types/account";

test("existing owner-scoped histories backfill through protocol-2; offline devices union turns without duplicates or account leakage",async()=>{
  const oldFetch=globalThis.fetch;const devices:JSDOM[]=[];
  const cloud=new Map<string,Map<string,AccountSyncObject>>();let posts=0,snapshots=0;let hideChanges=false;
  globalThis.fetch=async (input,init)=>{
    const owner=new Headers(init?.headers).get("X-Context-Account")!;assert.ok(owner);
    if(!cloud.has(owner))cloud.set(owner,new Map());const rows=cloud.get(owner)!;
    if(init?.method==="POST"){
      posts++;const incoming=JSON.parse(String(init.body)).objects as AccountSyncObject[];
      const conflict=incoming.some(o=>(rows.get(o.kind+":"+o.objectKey)?.serverVersion || 0)!==o.serverVersion);
      const results=incoming.map(o=>conflict?{...(rows.get(o.kind+":"+o.objectKey) || o),accepted:false}:{...o,serverVersion:o.serverVersion+1,accepted:true});
      if(!conflict)results.forEach(o=>rows.set(o.kind+":"+o.objectKey,o));
      return Response.json({objects:results},{status:conflict?409:200});
    }
    const params=new URL(String(input),"https://context-reader.com").searchParams;
    if(!params.has("bootstrap"))return Response.json({objects:hideChanges?[]:[...rows.values()],nextCursor:"current",hasMore:false});
    snapshots++;
    const learning=new Set(["article","vocabulary","reading_state"]);
    return Response.json({objects:[...rows.values()].filter(o=>Boolean(o.deletedAt)===(params.get("bootstrap")==="deleted") && learning.has(o.kind)===(params.get("group")==="learning")),nextOffset:null,snapshotCursor:"current"});
  };
  const select=async (device?:JSDOM,owner="A")=>{
    const dom=device || new JSDOM("",{url:"https://context-reader.com"});
    if(!device){devices.push(dom);Object.defineProperty(dom.window,"indexedDB",{value:new IDBFactory()});}
    Object.assign(globalThis,{window:dom.window,CustomEvent:dom.window.CustomEvent,indexedDB:dom.window.indexedDB});
    await initializeLearningStorage();await prepareLocalAccountForUser(owner);return dom;
  };
  const turn=(id:string)=>({id,createdAt:`2026-11-06T00:00:0${id}Z`,question:"What is it? "+id,answer:"Answer "+id,sources:[{title:"Reference",url:"https://example.org"}],notice:"Retrieved reference"});
  const a=documentQuestionScope("A","pdf-a"),b=documentQuestionScope("A","pdf-b");
  try{
    const first=await select();await saveDocumentQuestion(a,turn("1"));await saveDocumentQuestion(b,turn("2"));
    assert.equal(posts,0,"local/offline save never needs connectivity");
    await syncAccountData({dirtyKinds:["article"]});
    assert.equal(cloud.get("A")?.size,2,"legacy local records backfill even without preferences in dirty kinds");
    assert.ok([...cloud.get("A")!.values()].every(o=>o.kind==="preferences" && !(o.payload as object).hasOwnProperty("scope")));
    const second=await select();await syncAccountData();
    assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["1"]);
    assert.equal((await readDocumentQuestions(a))[0].sources?.[0].title,"Reference");
    assert.deepEqual((await readDocumentQuestions(b)).map(t=>t.id),["2"]);
    // Old app versions can advance a cursor/manifest without rendering this new
    // preference namespace. The first supporting version must recover that gap.
    const firstRecord={documentId:"pdf-a",turn:turn("1")};
    await mergeDocumentQuestionObjects("A",[{kind:"preferences",objectKey:documentQuestionObjectKey(firstRecord),payload:firstRecord,clientUpdatedAt:turn("1").createdAt,serverVersion:1,deletedAt:new Date().toISOString()}]);
    getLearningStorage().removeItem("context-reader:document-question-sync-recovery:v1");
    hideChanges=true;const beforeRecovery=snapshots;await syncAccountData();hideChanges=false;
    assert.ok(snapshots>beforeRecovery,"upgrade must replay a snapshot despite an up-to-date cursor");
    assert.equal((await readDocumentQuestions(a)).length,1);
    await saveDocumentQuestion(a,turn("3"));
    await select(first);await saveDocumentQuestion(a,turn("4"));await syncAccountData();
    await select(second);await syncAccountData();await syncAccountData();
    assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["1","3","4"]);
    const before=posts;await syncAccountData();assert.equal(posts,before,"acknowledged replay must not write again");
    await select(first);await syncAccountData();assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["1","3","4"]);
    await select(first,"B");await syncAccountData();
    assert.deepEqual(await readDocumentQuestions(documentQuestionScope("B","pdf-a")),[]);
    assert.equal(cloud.get("B")?.size,0,"A's independently stored history cannot upload under B");
    await select(first,"A");await syncAccountData();assert.equal((await readDocumentQuestions(a)).length,3);
    // Cloud tombstones remove one exact turn; stale local clients must not resurrect it.
    const key="preferences:"+documentQuestionObjectKey({documentId:"pdf-a",turn:turn("1")});
    const old=cloud.get("A")!.get(key)!;cloud.get("A")!.set(key,{...old,serverVersion:old.serverVersion+1,deletedAt:new Date().toISOString()});
    await syncAccountData();assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["3","4"]);
    await select(second);await syncAccountData();assert.deepEqual((await readDocumentQuestions(a)).map(t=>t.id),["3","4"]);
  }finally{
    globalThis.fetch=oldFetch;
    for(const dom of devices){Object.assign(globalThis,{window:dom.window});const storage=getLearningStorage();if(isLearningStorage(storage))storage.close();dom.window.close();}
  }
});

test("cloud history rejects mismatched and unsafe record shapes",()=>{
  assert.equal(normalizeDocumentQuestionRecord({documentId:"pdf",turn:{id:"1",createdAt:"invalid",question:"Q",answer:"A"}}),null);
  assert.equal(normalizeDocumentQuestionRecord({documentId:"pdf",turn:{id:"1",createdAt:"2026-11-06",question:"Q",answer:"A",sources:[{title:"Bad",url:"javascript:alert(1)"}]}}),null);
});
