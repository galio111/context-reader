import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "react";
import { DEFAULT_STUDY_SETTINGS, newMemory, shanghaiDay } from "../lib/studyScheduler";
import type { StudySnapshot } from "../types/study";
import { readStudyReviews } from "../lib/studyReviewQueue";

test("Study advances before a delayed save, keeps next answer visible, and restores an interrupted outbox",async()=>{
  const dom=new JSDOM("<!doctype html><body></body>",{url:"https://context-reader.com",pretendToBeVisual:true});
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,React}))Object.defineProperty(globalThis,key,{configurable:true,value});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  dom.window.HTMLElement.prototype.scrollTo=()=>{};
  dom.window.scrollTo=()=>{};
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
  const require=createRequire(import.meta.url);require.extensions[".css"]=(module)=>{module.exports={};};
  const mock=(path:string,exports:object)=>{const filename=require.resolve(path);require.cache[filename]={id:filename,filename,loaded:true,exports} as NodeModule;};
  const owner="00000000-0000-4000-8000-000000000001";
  mock("../components/AccountProvider",{useAccount:()=>({account:{profile:{userId:owner}},isOffline:false,syncNow:async()=>null,refreshAccount:async()=>{}})});
  mock("../components/useStudyVocabularyEntries",{useStudyVocabularyEntries:(entries:unknown[])=>entries??[]});
  mock("../components/useStudyTimer",{useStudyTimer:()=>()=>2000});
  mock("../components/StudyWord",{StudyWord:({entry}:{entry:{word:string}})=><div>{entry.word} answer</div>});
  mock("../components/StudyDictionaryHint",{StudyDictionaryHint:()=>null});
  mock("../components/BookDictionary",{BookDictionary:()=>null});
  for(const name of ["StudyRewards","StudySettings","StudyVocabulary","StudyStats"])mock("../components/"+name,{[name]:()=>null});
  const {StudyPanel}=await import("../components/StudyPanel");
  const {render,act,fireEvent,waitFor,cleanup}=await import("@testing-library/react");
  const now=new Date(), names=["alpha","beta","gamma"],ids=names.map((_,i)=>String(i+1).padStart(40,"a"));
  const base={serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards:ids.map((id,i)=>({id,entry_id:names[i],mode:"basic_en_to_cn",memory:{...newMemory(now),state:1},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()})),entries:names.map(word=>({id:word,word,sourceSentence:"",anki:{cardMode:"basic_en_to_cn"}})),today:{day:shanghaiDay(now),card_ids:ids,new_ids:ids,settings:DEFAULT_STUDY_SETTINGS,reward_points:0,completed_at:null},reviews:[],daily:[],policy:{},streak:{current:0,best:0,last_day:null},rewards:[],claims:[]} as unknown as StudySnapshot;
  const copy=()=>({...structuredClone(base),serverNow:new Date().toISOString()});
  let resolveReview!:(value:Response)=>void;
  let rejectReview!:(reason:Error)=>void;
  const requests:Array<Record<string,unknown>>=[],presented:string[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    const body=init?.body?JSON.parse(String(init.body)):null;
    if(body?.op==="present"){presented.push(body.cardId);return Response.json({token:"00000000-0000-4000-8000-000000000099"});}
    if(body?.op==="review"){requests.push(body);return new Promise<Response>((resolve,reject)=>{resolveReview=resolve;rejectReview=reject;});}
    return Response.json(copy());
  };
  const props={visible:true,onClose:()=>{},onSource:()=>{},notice:""};
  let ui=render(<StudyPanel {...props}/>);
  try {
    await waitFor(()=>assert.equal(presented[0],ids[0]));
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:/不记得/}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:/不记得/}));
    const next=await ui.findByRole("button",{name:"下一个"});
    const originalSet=dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.setItem=function(key,value){if(key.startsWith("context-reader-study-outbox:"))throw new Error("quota");originalSet.call(this,key,value);};
    fireEvent.click(next);
    assert.ok(ui.getByText("alpha answer"));assert.equal(requests.length,0);
    assert.ok(ui.getByText("本机空间不足或保存受限，请保留当前答案后重试。"));
    dom.window.Storage.prototype.setItem=originalSet;
    act(()=>{fireEvent.click(next);fireEvent.click(next);});
    assert.ok(ui.getByText("beta"));assert.equal(requests.length,1);assert.equal(readStudyReviews(localStorage,owner).length,1);
    assert.equal(ui.queryByText("保存中…"),null);assert.equal(presented.length,1);
    fireEvent.click(ui.getByRole("button",{name:/不记得/}));
    assert.ok(ui.getByText("beta answer"));
    assert.equal(ui.getByRole("button",{name:"准备中…"}).hasAttribute("disabled"),true);
    base.cards[0]={...base.cards[0],version:1,memory:{...base.cards[0].memory,due:new Date(now.getTime()+300000).toISOString()}};
    await act(async()=>{resolveReview(Response.json({snapshot:copy()}));});
    await waitFor(()=>assert.equal(presented.at(-1),ids[1]));
    assert.ok(ui.getByText("beta answer"));assert.equal(readStudyReviews(localStorage,owner).length,0);
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:"下一个"}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:"下一个"}));
    assert.ok(ui.getByText("gamma"));assert.equal(readStudyReviews(localStorage,owner).length,1);
    const originalId=requests.at(-1)!.id;
    await act(async()=>{rejectReview(new TypeError("lost response"));});
    assert.ok(ui.getByText("gamma"));assert.equal(readStudyReviews(localStorage,owner).length,1);
    await waitFor(()=>assert.equal(requests.length,3),{timeout:4000});
    assert.equal(requests.at(-1)!.id,originalId);
    ui.unmount();
    // A completed HTTP request after close/navigation must not erase an unacknowledged outbox.
    await act(async()=>{resolveReview(Response.json({snapshot:copy()}));});
    assert.equal(readStudyReviews(localStorage,owner).length,1);
    ui=render(<StudyPanel {...props}/>);
    await waitFor(()=>assert.equal(requests.length,4));
    assert.equal(requests.at(-1)!.id,originalId);
    base.cards[1]={...base.cards[1],version:1,memory:{...base.cards[1].memory,due:new Date(now.getTime()+300000).toISOString()}};
    await act(async()=>{resolveReview(Response.json({snapshot:copy()}));});
    await waitFor(()=>assert.equal(readStudyReviews(localStorage,owner).length,0));
    assert.ok(ui.getByText("gamma"));
  } finally {cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
