import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as scheduler from '../lib/studyScheduler';
import * as transport from '../lib/studyTransport';
import type { VocabularyEntry } from '../types/vocabulary';
import type { StudyCard } from '../types/study';

function harness(count: number) {
 const entries=Array.from({length:count},(_,i)=>({id:'entry-'+i,word:'word'+i,anki:{cardMode:'basic_en_to_cn'},dictionaryResult:{large:'x'.repeat(5000)}})) as unknown as VocabularyEntry[];
 const cards=entries.map(e=>({id:createHash('sha256').update(e.id).digest('hex').slice(0,40),entry_id:e.id,mode:e.anki.cardMode,memory:scheduler.newMemory(new Date()),version:0,suspended:false,anki_pending:false,created_at:new Date().toISOString()})) as StudyCard[];
 const reads:string[]=[];
 const accountFetch=async (path:string)=>{
  reads.push(path);
  const [table,query]=path.split('?'),q=new URLSearchParams(query),offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||50000);
  if(table==='user_data_objects')return entries.slice(offset,offset+limit).map(e=>{
   const select=q.get('select')??'';
   if(select==='object_key,payload')return {object_key:e.id,payload:structuredClone(e)};
   const fields=select.split(',').filter(field=>field.includes(':payload->')).map(field=>field.split(':')[0]);
   return {object_key:e.id,...Object.fromEntries(fields.map(field=>[field,structuredClone(e[field as keyof VocabularyEntry]??null)]))};
  });
  if(table==='study_cards')return structuredClone(cards.slice(offset,offset+limit));
  if(table==='study_settings')return [];
  if(table==='study_policy')return [{policy:{rewardsEnabled:true}}];
  if(table==='account_profiles')return [{status:'active'}];
  if(table==='rpc/study_settle_rewards')return {};
  if(table==='rpc/study_start_day_v4'){
   // Another device can review while this request is preparing its plan.
   cards[0].version=4;cards[0].memory.reps=4;return {};
  }
  if(table==='rpc/study_settle_rewards')return {};
  if(table.startsWith('study_')||table==='rpc/study_daily_stats_v3')return [];
  throw Error(path);
 };
 function load(file:string,imports:Record<string,unknown>){
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{module,exports:module.exports,require:(key:string)=>{if(key in imports)return imports[key];if(key==='@/lib/studyTransport')return transport;if(key==='./studyOfflinePermit')return {issueStudyOfflinePermit:()=> 'test-permit'};if(key==='@/lib/studyOfflineServer')return {saveStudyLocalEvent:()=>{throw Error('unexpected offline event');}};throw Error(key);},Date,Set,Map,URL,URLSearchParams,console,encodeURIComponent});
  return module.exports as typeof import('../lib/studyStore') & typeof import('../app/api/study/route');
 }
 const store=load('lib/studyStore.ts',{'server-only':{},'node:crypto':{createHash},'@/lib/accountStore':{accountFetch},'@/lib/studyScheduler':scheduler});
 const route=load('app/api/study/route.ts',{'next/server':{NextResponse:{json:(data:unknown,init?:ResponseInit)=>Response.json(data,init)}},'@/lib/accountStore':{accountFetch},'@/lib/userAuth':{getAuthenticatedUser:async()=>({id:'owner'})},'@/lib/requestSecurity':{requestExternalOrigin:()=> 'https://context-reader.com'},'@/lib/limitedBody':{readJsonBody:(r:Request)=>r.json(),RequestBodyTooLargeError:class extends Error{}},'@/lib/studyScheduler':scheduler,'@/lib/studyStore':store,'@/lib/serverErrorReporting':{recordServerError:async()=>{}}});
 return {store,route,reads,entries,cards};
}
test('start reads a 1200-entry vocabulary once while preserving the latest card versions',async()=>{
 const h=harness(1200);
 const response=await h.route.POST(new Request('https://context-reader.com/api/study',{method:'POST',headers:{Origin:'https://context-reader.com','X-Context-Account':'owner','Content-Type':'application/json'},body:JSON.stringify({op:'start'})}));
 assert.equal(response.status,200);const snapshot=await response.json();
 assert.equal(snapshot.entries.length,1200);assert.equal(snapshot.cards.length,1200);
 assert.equal(snapshot.cards[0].version,4);assert.equal(snapshot.cards[0].memory.reps,4);
 assert.equal(h.reads.filter(p=>p.startsWith('user_data_objects?')).length,3,'one paginated read, not six pages of repeated dictionaries');
 assert.equal(h.reads.filter(p=>p.startsWith('study_cards?')).length,9,'fresh card reads retained across reconciliation and the start transaction');
 assert.ok(snapshot.entries.every((e:VocabularyEntry)=>!e.dictionaryResult));
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('prepared and ordinary snapshots have identical vocabulary and preserve Anki filtering',async()=>{
 const h=harness(3);h.cards[1].anki_pending=true;h.cards[2].suspended=true;
 const normal=await h.store.getStudySnapshot('owner');
 const entries=await h.store.getStudyEntries('owner');
 h.reads.length=0;
 const prepared=await h.store.getStudySnapshot('owner',{entries});
 assert.deepEqual(JSON.parse(JSON.stringify({...prepared,serverNow:''})),JSON.parse(JSON.stringify({...normal,serverNow:''})));assert.equal(prepared.entries.length,1);assert.equal(prepared.ankiPendingCount,1);
 assert.equal(h.reads.filter(p=>p.startsWith('user_data_objects?')).length,0);
});
test('the expected-account header still rejects a different authenticated owner',async()=>{
 const h=harness(1);
 const response=await h.route.POST(new Request('https://context-reader.com/api/study',{method:'POST',headers:{Origin:'https://context-reader.com','X-Context-Account':'other'},body:JSON.stringify({op:'start'})}));
 assert.equal(response.status,409);assert.equal(h.reads.length,0);
});
