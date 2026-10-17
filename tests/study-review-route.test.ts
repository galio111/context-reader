import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STUDY_SETTINGS, newMemory } from "../lib/studyScheduler";

test("review distinguishes retryable day changes from real version conflicts without settling failed answers",async()=>{
  const require=createRequire(import.meta.url),restores:Array<()=>void>=[];
  const mock=(path:string,exports:object)=>{const id=require.resolve(path),old=require.cache[id];require.cache[id]={id,filename:id,loaded:true,exports} as NodeModule;restores.push(()=>{if(old)require.cache[id]=old;else delete require.cache[id];});};
  const owner="00000000-0000-4000-8000-000000000001",cardId="a".repeat(40),token="00000000-0000-4000-8000-000000000002";
  const card={id:cardId,memory:newMemory(new Date()),version:0,suspended:false,anki_pending:false};
  let rpcResult:Record<string,unknown>={dayChanged:true},snapshots=0,settlements=0;
  mock("../lib/userAuth",{getAuthenticatedUser:async()=>({id:owner})});
  mock("../lib/serverErrorReporting",{recordServerError:async()=>{}});
  mock("../lib/accountStore",{accountFetch:async(path:string)=>{
    if(path.startsWith("account_profiles?"))return [{status:"active"}];
    if(path.startsWith("study_cards?"))return [card];
    if(path.startsWith("study_days?")){assert.ok(path.includes("select=settings"));return [];}
    if(path.startsWith("study_reviews?"))return [{id:"00000000-0000-4000-8000-000000000003",card_id:cardId,answer:"forgot"}];
    throw new Error("unexpected read "+path);
  }});
  mock("../lib/studyStore",{
    getStudySettings:async()=>DEFAULT_STUDY_SETTINGS,
    getStudySnapshot:async()=>{snapshots++;return {serverNow:new Date().toISOString()};},
    reconcileStudyCards:async()=>{},
    studyRpc:async(name:string)=>{if(name==="review_v3"||name==="present_day_v4")return rpcResult;if(name==="daily_stats_v3")return [];if(name==="settle_rewards"){settlements++;return {};}throw new Error("unexpected rpc "+name);},
  });
  try {
    const {POST}=await import("../app/api/study/route");
    const request=()=>new Request("https://context-reader.com/api/study",{method:"POST",headers:{origin:"https://context-reader.com","content-type":"application/json","X-Context-Account":owner},body:JSON.stringify({op:"review",id:"00000000-0000-4000-8000-000000000003",cardId,version:0,token,answer:"forgot",activeMs:1000})});
    for(const [state,code] of [[{dayChanged:true},"day_changed"],[{conflict:true},"state_changed"],[{tooFast:true},"too_fast"]] as const){
      rpcResult=state;const response=await POST(request());assert.equal(response.status,409);assert.equal((await response.json()).code,code);
      assert.equal(snapshots,0);assert.equal(settlements,0);
    }
    for(const state of [{earlierStageFirst:true},{notDue:true},{notPlanned:true},{conflict:true},{paused:true},{ankiPending:true}]){
      rpcResult=state;
      const response=await POST(new Request("https://context-reader.com/api/study",{method:"POST",headers:{origin:"https://context-reader.com","content-type":"application/json"},body:JSON.stringify({op:"present",cardId,version:0})}));
      assert.equal(response.status,409);assert.equal((await response.json()).code,"presentation_changed");
      assert.equal(snapshots,0);assert.equal(settlements,0);
    }
    rpcResult={duplicate:true};const response=await POST(request());
    assert.equal(response.status,200);assert.equal((await response.json()).saved,true);assert.equal(snapshots,1);assert.equal(settlements,1);
    for(const state of [{saved:true},{duplicate:true}]){
      rpcResult=state;const original=request();const body=await original.json();
      const compact=await POST(new Request(original.url,{method:"POST",headers:original.headers,body:JSON.stringify({...body,response:"receipt"})}));
      assert.equal(compact.status,200);const data=await compact.json();
      assert.equal(data.saved,true);assert.equal(data.receipt.review.id,body.id);assert.equal(data.receipt.card.id,cardId);
      assert.equal(data.snapshot,undefined);assert.equal(snapshots,1,"receipt must not wait for a full snapshot");assert.equal(settlements,1,"reward work cannot delay acknowledgement");
    }
  } finally {restores.reverse().forEach(restore=>restore());}
});
