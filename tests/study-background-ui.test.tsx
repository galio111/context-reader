import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "react";
import { DEFAULT_STUDY_SETTINGS, newMemory, shanghaiDay } from "../lib/studyScheduler";
import type { StudySnapshot } from "../types/study";
import { readStudyReviews, storeStudyReview, type PendingStudyReview } from "../lib/studyReviewQueue";

test("Study advances immediately, keeps a new answer visible across another tab's review acknowledgement, and restores interrupted saves",async()=>{
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
  const base={serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards:ids.map((id,i)=>({id,entry_id:names[i],mode:"basic_en_to_cn",memory:{...newMemory(now),state:i===0?2:0},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()})),entries:names.map(word=>({id:word,word,sourceSentence:"",anki:{cardMode:"basic_en_to_cn"}})),today:{day:shanghaiDay(now),card_ids:ids,new_ids:ids.slice(1),settings:DEFAULT_STUDY_SETTINGS,reward_points:0,completed_at:null},reviews:[],daily:[],policy:{},streak:{current:0,best:0,last_day:null},rewards:[],claims:[]} as unknown as StudySnapshot;
  const copy=()=>({...structuredClone(base),serverNow:new Date().toISOString()});
  let resolveReview!:(value:Response)=>void;
  let rejectReview!:(reason:Error)=>void;
  let delaySnapshot=false, snapshotReads=0, resolveSnapshot!:(value:Response)=>void;
  let missingPlan=false, missingPlanStarts=0;
  let delayStart=false, resolveStart!:(value:Response)=>void;
  const requests:Array<Record<string,unknown>>=[],presented:string[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    const body=init?.body?JSON.parse(String(init.body)):null;
    if(body?.op==="start"&&delayStart)return new Promise<Response>(resolve=>{resolveStart=resolve;});
    if(body?.op==="start"&&missingPlan){
      missingPlanStarts++;
      if(missingPlanStarts===1)return Response.json({...copy(),today:null});
      if(missingPlanStarts===2)return Response.json({error:"暂时无法创建今日计划"},{status:503});
      missingPlan=false;
    }
    if(!body&&missingPlan)return Response.json({...copy(),today:null});
    if(body?.op==="present"){presented.push(body.cardId);return Response.json({token:"00000000-0000-4000-8000-000000000099"});}
    if(body?.op==="review"){requests.push(body);return new Promise<Response>((resolve,reject)=>{resolveReview=resolve;rejectReview=reject;});}
    if(!body&&delaySnapshot){snapshotReads++;return new Promise<Response>(resolve=>{resolveSnapshot=resolve;});}
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
    assert.ok(ui.getByText("beta"));assert.equal(readStudyReviews(localStorage,owner).length,1);
    await waitFor(()=>assert.equal(requests.length,1));
    assert.equal(ui.queryByText("保存中…"),null);assert.equal(presented.length,1);
    fireEvent.click(ui.getByRole("button",{name:/不记得/}));
    assert.ok(ui.getByText("beta answer"));
    assert.equal(ui.getByRole("button",{name:"准备中…"}).hasAttribute("disabled"),true);
    base.cards[0]={...base.cards[0],version:1,memory:{...base.cards[0].memory,state:3,due:new Date(now.getTime()+300000).toISOString()}};
    // The other tab saved the same answer and removed its key. Our review HTTP
    // response is still pending: removing the overlay now would resurrect alpha
    // as a due review and remove beta's already-open answer.
    const firstKey=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(key=>key?.startsWith("context-reader-study-outbox:"))!;
    delaySnapshot=true;
    act(()=>{localStorage.removeItem(firstKey);dom.window.dispatchEvent(new dom.window.StorageEvent("storage",{key:firstKey,newValue:null}));});
    assert.ok(ui.getByText("beta answer"));assert.equal(presented.length,1);
    await act(async()=>{rejectReview(new TypeError("lost own response"));});
    await waitFor(()=>assert.equal(snapshotReads,1),{timeout:4000});
    assert.ok(ui.getByText("beta answer"));assert.equal(presented.length,1);
    delaySnapshot=false;
    await act(async()=>{resolveSnapshot(Response.json(copy()));});
    await waitFor(()=>assert.equal(presented.at(-1),ids[1]));
    assert.ok(ui.getByText("beta answer"));assert.equal(readStudyReviews(localStorage,owner).length,0);
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:"下一个"}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:"下一个"}));
    assert.ok(ui.getByText("gamma"));assert.equal(readStudyReviews(localStorage,owner).length,1);
    await waitFor(()=>assert.equal(requests.length,2));
    const originalId=requests.at(-1)!.id;
    await act(async()=>{rejectReview(new TypeError("lost response"));});
    assert.equal(ui.queryByText(/答案已保存在本机|暂时无法同步|重试同步|正在同步学习记录/),null,"background retries do not interrupt studying with save notices");
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
    // A held outbox write must not hold the initial snapshot or next-card recall.
    await waitFor(()=>assert.ok(ui.getByText("gamma")));
    assert.equal(ui.getByRole("button",{name:/不记得/}).hasAttribute("disabled"),false);
    base.cards[1]={...base.cards[1],version:1,memory:{...base.cards[1].memory,state:1,due:new Date(now.getTime()+300000).toISOString()}};
    await act(async()=>{resolveReview(Response.json({snapshot:copy()}));});
    await waitFor(()=>assert.equal(readStudyReviews(localStorage,owner).length,0));
    assert.ok(ui.getByText("gamma"));
    ui.unmount();missingPlan=true;
    ui=render(<StudyPanel {...props}/>);
    await waitFor(()=>assert.equal(missingPlanStarts,2));
    await waitFor(()=>assert.ok(ui.getByText("暂时无法创建今日计划")));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    assert.equal(missingPlanStarts,2,"a missing plan must not start an unbounded tick/busy retry loop");
    fireEvent.click(ui.getByRole("button",{name:"重试"}));
    await waitFor(()=>assert.equal(missingPlanStarts,3));
    await waitFor(()=>assert.ok(ui.getByText("gamma")));
    ui.unmount();delayStart=true;
    storeStudyReview(localStorage,owner,requests.at(-1) as unknown as PendingStudyReview);
    ui=render(<StudyPanel {...props}/>);
    await waitFor(()=>assert.equal(requests.length,5));
    await act(async()=>{resolveReview(Response.json({snapshot:copy()}));});
    await waitFor(()=>assert.ok(ui.getByText("gamma")));
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:/不记得/}).hasAttribute("disabled"),false));
    assert.equal(readStudyReviews(localStorage,owner).length,0,"fast queue confirmation unlocks the first snapshot before start finishes");
    delayStart=false;await act(async()=>{resolveStart(Response.json(copy()));});
    ui.unmount();
    // The real receipt protocol updates counts and active category immediately,
    // even while the next complete snapshot is held indefinitely.
    base.cards=base.cards.map((c,i)=>({...c,version:0,memory:{...newMemory(now),state:i===0?1:i===1?2:0}}));
    base.reviews=[];base.daily=[];let receiptStarts=0,receiptWrites=0;
    globalThis.fetch=async(_url,init)=>{
      const b=init?.body?JSON.parse(String(init.body)):null;
      if(b?.op==="start"){receiptStarts++;if(receiptStarts>1)return new Promise<Response>(()=>{});return Response.json(copy());}
      if(b?.op==="present")return Response.json({token:"00000000-0000-4000-8000-000000000099"});
      if(b?.op==="review"){
        assert.equal(b.response,"receipt");receiptWrites++;
        const c=base.cards.find(c=>c.id===b.cardId)!,previous={...c.memory};
        c.version++;c.memory={...c.memory,state:previous.state===2?3:previous.state===0?1:2,last_review:new Date().toISOString(),due:new Date(now.getTime()+86400000).toISOString()};
        const review={id:b.id,card_id:c.id,answer:b.answer,rating:3,reviewed_at:new Date().toISOString(),active_ms:1000,undone:false,previous,next:c.memory};
        const todayStats={day:shanghaiDay(now),cards:receiptWrites,new_cards:previous.state===0?1:0,active_ms:1000,successes:1,reviews:receiptWrites};
        return Response.json({saved:true,id:b.id,receipt:{serverNow:new Date().toISOString(),card:c,review,todayStats}});
      }
      return Response.json(copy());
    };
    ui=render(<StudyPanel {...props}/>);
    const active=()=>ui.container.querySelector('[aria-current="step"]')?.textContent;
    await waitFor(()=>assert.equal(active(),"正在背 1"));
    fireEvent.click(ui.getByRole("button",{name:/^3\s*记得$/}));
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:"答对了"}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:"答对了"}));
    await waitFor(()=>assert.equal(active(),"待复习 1"));
    await waitFor(()=>assert.ok(ui.getByText("正在背").textContent?.includes("0")));
    assert.ok(ui.getByText("今日新学").textContent?.includes("0"));
    fireEvent.click(ui.getByRole("button",{name:/^3\s*记得$/}));
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:"答对了"}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:"答对了"}));
    await waitFor(()=>assert.equal(active(),"今日新学 0"));
    assert.ok(ui.getByText("待复习").textContent?.includes("0"));
    // Merely presenting the untouched new word cannot add it to ongoing learning.
    assert.equal(ui.getByText("正在背").textContent,"正在背 1");
    assert.equal(base.cards[2].memory.state,0);
    assert.equal(receiptWrites,2);
    fireEvent.click(ui.getByRole("button",{name:/^3\s*记得$/}));
    await waitFor(()=>assert.equal(ui.getByRole("button",{name:"答对了"}).hasAttribute("disabled"),false));
    fireEvent.click(ui.getByRole("button",{name:"答对了"}));
    await waitFor(()=>assert.ok(ui.getByText("今日新学").textContent?.includes("1")));
    assert.equal(ui.getByText("正在背").textContent,"正在背 2");
    assert.equal(readStudyReviews(localStorage,owner).length,0);assert.equal(receiptWrites,3);
  } finally {cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
