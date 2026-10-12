import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { cetLearningSummary } from "../lib/cetLearningSummary";
import { installExperiencePreview, previewAccount, experiencePreviewStorage } from "../lib/experiencePreview";
import type { CetActivity } from "../types/cet";
import type { AccountPlan } from "../types/account";

test("CET accuracy counts canonical submissions, excludes conflicts and study exits",()=>{
 const activity=(finalizations:Record<string, any>)=>({finalizations:Object.fromEntries(Object.entries(finalizations).map(([key,row])=>[key,{...row,questions:Array.from({length:row.scoreable},(_,i)=>({key:String(i),answer:"A",options:[{key:"A"},{key:"B"}]})),answers:Object.fromEntries(Array.from({length:row.scoreable},(_,i)=>[String(i),i<row.correct?"A":"B"]))}]))}) as CetActivity;
 const result=cetLearningSummary([
  activity({a:{id:"a",sectionId:"s1",correct:2,scoreable:5,reason:"passage_submit"},b:{id:"b",correct:8,scoreable:10,reason:"manual_submit"}}),
  activity({a:{id:"b",correct:8,scoreable:10,reason:"manual_submit"}}),
  activity({a:{id:"c",sectionId:"s2",correct:1,scoreable:5,reason:"ended_for_study"}}),
  activity({a:{id:"d",sectionId:"s3",correct:1,scoreable:5,reason:"passage_submit"},b:{id:"e",sectionId:"s3",correct:5,scoreable:5,reason:"passage_submit"}}),
  activity({a:{id:"f",sectionId:"s4",correct:3,scoreable:5,reason:"passage_submit"}}),
 ]);
 assert.deepEqual(result,{correct:11,scoreable:15,submissions:2,excluded:1});
});

test("developer preview isolates storage and never forwards account, paid work or mutation requests",async()=>{
 const dom=new JSDOM("",{url:"https://context-reader.com/admin/experience/frame?plan=basic"});
 const keys=["window","document","location"];
 const original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,value:(dom.window as unknown as Record<string,unknown>)[k]});
 const win=dom.window as unknown as Window & typeof globalThis;
 const actual=win.localStorage;actual.setItem("real-owner-data","preserved");
 const calls:string[]=[];win.fetch=async(input)=>{calls.push(String(input));return new Response(JSON.stringify({plans:[],membership:{private:true},orders:["private"]}));};
 const plan:AccountPlan={id:"basic",displayName:"Basic",active:true,priceCny:12,limits:[{metricKey:"learning_points",allowance:1000,windowType:"month"}]};
 const account=previewAccount(plan,"empty");
 const restore=installExperiencePreview(account);
 try {
  assert.notEqual(win.localStorage,actual);assert.equal(experiencePreviewStorage(),win.localStorage);
  win.localStorage.setItem("real-owner-data","fake");assert.equal(actual.getItem("real-owner-data"),"preserved");
  assert.equal((await (await win.fetch("/api/auth/session")).json()).account.plan.id,"basic");
  const paid=await win.fetch("/api/standalone-dictionary",{method:"POST",body:"{}"});assert.equal(paid.status,429);
  assert.equal((await paid.json()).code,"quota_exhausted");
  assert.equal((await win.fetch("/api/account/profile",{method:"POST",body:"{}"})).status,403);
  assert.equal((await win.fetch("https://external.test/write",{method:"POST"})).status,403);
  const billing=await (await win.fetch("/api/billing?includeAccount=1")).json();assert.equal(billing.membership,null);assert.deepEqual(billing.orders,[]);
  assert.deepEqual(calls,["/api/billing"]);
  assert.equal(previewAccount({...plan,id:"guest"},"available").authenticated,false);
  assert.equal(previewAccount(plan,"low").usage[0].remaining,40);
 } finally {restore();assert.equal(win.localStorage,actual);assert.equal(actual.getItem("real-owner-data"),"preserved");dom.window.close();for(const [k,d] of original){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
