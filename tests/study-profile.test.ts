import {createRequire} from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_STUDY_POLICY} from "../lib/studyPolicy";
test("profile charges the confirmed price once, replays results, refunds failures and releases only its own lease",async()=>{
 const require=createRequire(import.meta.url),restores:Array<()=>void>=[];
 const mock=(path:string,exports:object)=>{const id=require.resolve(path),old=require.cache[id];require.cache[id]={id,filename:id,loaded:true,exports} as NodeModule;restores.push(()=>{if(old)require.cache[id]=old;else delete require.cache[id];});};
 const action="cdd022f6-a944-4b5a-9f13-7e8608ae0d73";
 let claimed=false,previous:Array<Record<string,unknown>>=[],bad=false,requests=0,reservations=0,refunds=0,finishes=0,releases=0;
 mock("../lib/studyAuth",{studyOwner:async()=>"owner"});
 mock("../lib/serverErrorReporting",{recordServerError:async()=>null});
 mock("../lib/studyStore",{getStudyPolicy:async()=>DEFAULT_STUDY_POLICY,studyRows:async()=>[{active_seconds:3600,words:Array.from({length:50},(_,i)=>"word"+i),articles:["a"]}],studyRpc:async(name:string)=>{
  if(name==="profile_claim"){if(claimed)return {claimed:false};claimed=true;return {claimed:true};}
  if(name==="profile_release"){releases++;claimed=false;return;}
  return [];
 }});
 mock("../lib/accountStore",{accountFetch:async(path:string,init?:RequestInit)=>{if(init?.method==="POST"){previous=[JSON.parse(String(init.body))];return;}return previous;},finishUsage:async()=>{finishes++;},refundUsage:async()=>{refunds++;},recordUsageExecution:async()=>{}});
 mock("../lib/usageGate",{gateUsage:async(_:Request,o:{units:number;feature:string})=>{assert.equal(o.units,5);assert.equal(o.feature,"vocabulary_profile");reservations++;return {actionId:action,reservation:{duplicate:false}};},usageErrorResponse:()=>null});
 mock("../lib/costConcurrency",{acquireAiSlot:async()=>()=>{}});
 mock("../lib/modelSettings",{withModelContext:(_s:string,fn:()=>unknown)=>fn()});
 mock("../lib/providerFailover",{fetchWithProviderFailover:async()=>{requests++;return Response.json({choices:[{message:{content:bad?'{}':JSON.stringify({summary:"根据有限的阅读记录，建议继续练习语境中的词义。",recommendedLevel:"四级",strengths:[],focus:["复习近期生词"]})}}],usage:{prompt_tokens:100,completion_tokens:30}});},responseModel:()=>"deepseek-flash",providerName:()=>"deepseek"});
 try{
  const {POST}=await import("../app/api/study/profile/route");
  const request=(cost=5,id=action)=>new Request("https://context-reader.com/api/study/profile",{method:"POST",headers:{origin:"https://context-reader.com","content-type":"application/json","x-context-action-id":id},body:JSON.stringify({confirmedCost:cost})});
  assert.equal((await POST(request(4))).status,409);assert.equal(reservations,0);
  claimed=true;assert.equal((await POST(request())).status,409);assert.equal(releases,0);assert.equal(claimed,true);
  claimed=false;assert.equal((await POST(request())).status,200);assert.equal(requests,1);assert.equal(reservations,1);assert.equal(finishes,1);assert.equal(refunds,0);assert.equal(releases,1);
  assert.equal((await POST(request())).status,200);assert.equal(requests,1);assert.equal(reservations,1);
  bad=true;assert.equal((await POST(request(5,"edd022f6-a944-4b5a-9f13-7e8608ae0d73"))).status,503);assert.equal(refunds,1);assert.equal(releases,2);
 }finally{restores.reverse().forEach(f=>f());}
});
