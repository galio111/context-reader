import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { initializeLearningStorage, getLearningStorage, flushLearningStorage, isLearningStorage } from "../lib/learningStorage";
import { prepareLocalAccountForUser, syncAccountData } from "../lib/accountSyncClient";
import {saveCetTrail,readCetTrail} from "../lib/cetTypeTrailStorage";
import {adjustCetTimer,projectCetTimer} from "../lib/cetAdjustableTimer";
import { createCetActivity, cetAnswer, cetPause, cetResume, cetFinalize } from "../lib/cetActivity";
import { saveCetActivity, readCetActivities, readCetCommitPackages } from "../lib/cetActivityStorage";
import { readStoredArticles, writeStoredArticles } from "../lib/articleStorage";
import type { AccountSyncObject } from "../types/account";
import { syncAccountData as syncOldAccountData } from "./fixtures/cet-v2-sync-client";
import type { CetPaper } from "../types/cet";
const paper=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-12-1.json',import.meta.url),'utf8')) as CetPaper;
test('v4 adjusted timer roundtrip preserves v2/v3 sources through old client and immutable finalization',async()=>{
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
 try{
  const first=await select();writeStoredArticles(getLearningStorage(),[{id:"article-A",title:"Original article",body:"Keep this reading article.",summary:"",createdAt:"2026-09-24T00:00:00Z",updatedAt:"2026-09-24T00:00:00Z"}]);let up=createCetActivity({paper,purpose:'self_test',owner:'A',timerMode:'countup',now:'2026-09-24T00:00:00Z'});
  up=cetAnswer(up,up.questionKeys[0],'A','2026-09-24T00:00:01Z','answer');up=cetPause(up,'2026-09-24T00:00:30Z','pause');saveCetActivity(up);
  const down=createCetActivity({paper,purpose:'self_test',owner:'A'});saveCetActivity(down);await flushLearningStorage();await syncAccountData();
  assert.ok(cloud.has(`preferences:cet-activity:v3:${up.id}`));assert.ok(cloud.has(`preferences:cet-activity:v2:${down.id}`));
  saveCetTrail({id:'route-A',owner:'A',level:4,type:'detail',purpose:'practice',paperId:paper.id,sectionId:'detail1',activityId:up.id,at:'2026-09-24T00:00:30Z',reason:'assistance_shown',round:'initial'});await flushLearningStorage();await syncAccountData();
  const second=await select();await syncAccountData();assert.equal(readStoredArticles(getLearningStorage())[0].id,"article-A");assert.equal(readCetActivities().length,2);const received=readCetActivities().find(a=>a.id===up.id)!;assert.equal(received.status,'paused');assert.equal(received.elapsedMs,30000);
  const adjusted=adjustCetTimer(received,{owner:'A',activityId:received.id,sectionId:received.activeSection,revision:received.timerRevision},'countdown',10,'2026-09-24T00:00:40Z','adjust');
  saveCetActivity(adjusted);await syncAccountData();assert.equal(readCetActivities().filter(a=>a.id===up.id).length,1);
  assert.equal(projectCetTimer(readCetActivities().find(a=>a.id===up.id)!,received.activeSection).remaining,600000);
  const done=cetFinalize(cetResume(adjusted,'2026-09-24T00:01:00Z','resume'),paper,'manual_submit',undefined,'2026-09-24T00:01:10Z','final');saveCetActivity(done);await syncAccountData();
  assert.ok(cloud.has(`preferences:cet-finalization:v4:${up.id}:final`));await select(first);await syncAccountData();await syncAccountData();
  const replay=readCetActivities().find(a=>a.id===up.id)!;assert.equal(replay.finalizations.final.elapsedMs,40000);assert.equal(replay.answers[up.questionKeys[0]].value,'A');assert.equal(readCetCommitPackages().filter(p=>p.schemaVersion===4).length,1);
  assert.ok(!writes.some(o=>o.deletedAt));assert.ok(writes.filter(o=>o.objectKey.startsWith('cet-activity:v2:')).every(o=>(o.payload as {schemaVersion:number}).schemaVersion===2));
  await select(second);assert.equal(readCetActivities().find(a=>a.id===up.id)?.finalizations.final.elapsedMs,40000);
  await syncAccountData();assert.equal(readCetTrail().filter(e=>e.id==='route-A').length,1);
  saveCetTrail({id:'route-B',owner:'A',level:4,type:'detail',purpose:'practice',paperId:paper.id,sectionId:'detail2',activityId:down.id,at:'2026-09-24T00:00:31Z',reason:'answer',round:'initial'});await flushLearningStorage();await syncAccountData();
  await select(first);await syncAccountData();await syncAccountData();assert.deepEqual(readCetTrail().map(e=>e.id),['route-A','route-B']);await select(second);
  // An actual pre-v3 sync client sees the newer namespace on the wire. It must
  // neither overwrite it with a v2 payload nor tombstone unknown objects.
  await syncOldAccountData();
  assert.ok(cloud.has(`preferences:cet-activity:v4:${up.id}`));
  assert.ok(cloud.has(`preferences:cet-activity:v3:${up.id}`));
  assert.ok(cloud.has(`preferences:cet-finalization:v4:${up.id}:final`));
  assert.ok(!writes.some(o=>o.deletedAt));
  await syncAccountData();
  assert.equal(readCetActivities().find(a=>a.id===up.id)?.finalizations.final.elapsedMs,40000);
  assert.ok(readCetActivities().some(a=>a.id===down.id));
  assert.equal(readStoredArticles(getLearningStorage())[0].id,'article-A');
 }finally{globalThis.fetch=originalFetch;const storage=getLearningStorage();if(isLearningStorage(storage))storage.close();devices.forEach(d=>d.window.close());}
});
