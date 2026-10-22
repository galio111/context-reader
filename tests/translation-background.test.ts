import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { getArticleTranslationJobSnapshot, startArticleTranslationJob, subscribeArticleTranslationJob } from "../lib/articleTranslationJobs";
import { initializeLearningStorage, flushLearningStorage, getLearningStorage, isLearningStorage } from "../lib/learningStorage";

test("translation survives leaving its panel, retries only missing blocks and finishes one action",async()=>{
 const dom=new JSDOM("",{url:"https://context-reader.com"});
 const original=new Map(["window","document","CustomEvent"].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of original.keys())Object.defineProperty(globalThis,k,{configurable:true,value:(dom.window as unknown as Record<string,unknown>)[k]});
 Object.defineProperty(dom.window,"indexedDB",{value:new IDBFactory()});
 const nativeFetch=globalThis.fetch,calls:Array<{path:string;body:Record<string,unknown>;keepalive?:boolean}>=[];
 let resolve!:()=>void;const wait=new Promise<void>(r=>resolve=r);let attempts=0;
 const contextOnly={id:"body-context",type:"paragraph" as const,text:"The body defines terms used by the figure caption."};
 const block={id:"one",type:"paragraph" as const,text:"A deliberate reading session helps learning."};
 globalThis.fetch=async(input,init)=>{
  const path=String(input),body=JSON.parse(String(init?.body));calls.push({path,body,keepalive:init?.keepalive});
  if(path.endsWith("/start"))return Response.json({actionId:"one-action",source:"generated"});
  if(path.endsWith("/finish"))return Response.json({ok:true});
  assert.equal((init?.headers as Record<string,string>)["x-context-translation-action-id"],"one-action");
  attempts++;await wait;
  if(attempts===1)return new Response(JSON.stringify({type:"error",code:"provider_temporary",error:"temporary"})+"\n");
  return new Response(JSON.stringify({type:"translation",translation:{id:"one",type:"paragraph",translation:"专注阅读有助于学习。"}})+"\n");
 };
 try{
  await initializeLearningStorage();
  const key="background-"+crypto.randomUUID();let notifications=0;
  const unsubscribe=subscribeArticleTranslationJob(key,()=>notifications++);
  const running=startArticleTranslationJob(key,[block],{allBlocks:[block],contextBlocks:[contextOnly,block]});
  while(!attempts)await new Promise(r=>setTimeout(r,5));
  unsubscribe();const before=notifications;resolve();await running;
  assert.equal(notifications,before,"unmounted panel receives no updates");
  assert.equal(getArticleTranslationJobSnapshot(key)?.loading,false);assert.equal(getArticleTranslationJobSnapshot(key)?.translations[0].translation,"专注阅读有助于学习。");
  assert.equal(calls.filter(c=>c.path.endsWith("/start")).length,1);
  const providerCalls=calls.filter(c=>c.path==="/api/translate-article");
  assert.ok(providerCalls.length>0);
  for(const call of providerCalls){assert.deepEqual(call.body.blocks,[block]);assert.deepEqual(call.body.contextBlocks,[contextOnly,block]);}
  assert.equal(getArticleTranslationJobSnapshot(key)?.translations.length,1,"context is not translated or charged as a target");
  assert.deepEqual(calls.filter(c=>c.path.endsWith("/finish")).map(c=>[c.body.status,c.keepalive]),[["succeeded",true]]);
  await startArticleTranslationJob(key,[block]);assert.equal(attempts,2,"reopening the completed job causes no generation");
 }finally{await flushLearningStorage();const s=getLearningStorage();if(isLearningStorage(s))s.close();globalThis.fetch=nativeFetch;dom.window.close();for(const[k,d]of original){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
