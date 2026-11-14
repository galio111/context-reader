import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { startDocumentQuestionJob, getDocumentQuestionJob, subscribeDocumentQuestionJob } from "../lib/documentQuestionJobs";
import { documentQuestionScope, readDocumentQuestions } from "../lib/documentQuestionHistory";
import { initializeLearningStorage, getLearningStorage, LEARNING_STORAGE_EVENT } from "../lib/learningStorage";

const until = async (condition: () => boolean) => {
  for (let i=0;i<100;i++) { if(condition())return; await new Promise(resolve=>setTimeout(resolve,10)); }
  assert.ok(condition(), "job did not settle");
};

test("background document questions retain failures, deduplicate submits, save with no views and cancel only across owners", async () => {
  const dom = new JSDOM("", {url:"https://context-reader.com"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent,indexedDB:new IDBFactory()});
  Object.defineProperty(dom.window,"indexedDB",{value:globalThis.indexedDB});
  await initializeLearningStorage();
  const storage=getLearningStorage();
  storage.setItem("context-reader:local-account-owner:v1","one");
  const scope=documentQuestionScope("one","paper");
  const request={word:"",sentence:"",previousSentence:"",nextSentence:"",question:"Explain this material",autoSearch:true,document:{title:"Paper",blocks:[]}};
  const previous=globalThis.fetch;
  let complete!: (value:Response)=>void;
  let signal:AbortSignal|null|undefined;
  let calls=0;
  globalThis.fetch=async (_url,init)=>{calls++;signal=init?.signal;return new Promise<Response>(resolve=>{complete=resolve;});};
  try {
    const unsubscribe=subscribeDocumentQuestionJob(scope,()=>{});
    startDocumentQuestionJob(scope,request);
    startDocumentQuestionJob(scope,request);
    assert.equal(calls,1);
    unsubscribe();
    assert.equal(signal?.aborted,false);
    complete(Response.json({error:"provider failed"},{status:502}));
    await until(()=>getDocumentQuestionJob(scope)?.loading===false);
    assert.equal(getDocumentQuestionJob(scope)?.turn.question,request.question);
    assert.match(getDocumentQuestionJob(scope)?.error ?? "",/问题已保留/);
    startDocumentQuestionJob(scope,request);
    complete(Response.json({answer:"Saved after every view closed",sources:[]}));
    await until(()=>getDocumentQuestionJob(scope)?.turn.answer==="Saved after every view closed");
    let rows=await readDocumentQuestions(scope);
    for(let i=0;!rows.length && i<20;i++){await new Promise(resolve=>setTimeout(resolve,10));rows=await readDocumentQuestions(scope);}
    assert.equal(rows[0].answer,"Saved after every view closed");
    startDocumentQuestionJob(scope,{...request,question:"A later question"});
    const late=complete;
    storage.setItem("context-reader:local-account-owner:v1","two");
    dom.window.dispatchEvent(new dom.window.CustomEvent(LEARNING_STORAGE_EVENT));
    assert.equal(signal?.aborted,true);
    assert.equal(getDocumentQuestionJob(scope),null);
    late(Response.json({answer:"Must not appear for the next account"}));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await readDocumentQuestions(scope)).length,1);
    assert.equal((await readDocumentQuestions(documentQuestionScope("two","paper"))).length,0);
  } finally { globalThis.fetch=previous;dom.window.close(); }
});
