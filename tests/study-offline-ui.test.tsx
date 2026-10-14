import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {JSDOM} from "jsdom";
import {IDBFactory} from "fake-indexeddb";
import * as React from "react";
import {DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay} from "../lib/studyScheduler";
import type {StudySnapshot} from "../types/study";
import {updateStudyLocalRecord} from "../lib/studyOfflineStore";
import {applyLocalStudyEvent,type StudyLocalEvent} from "../lib/studyOffline";

test("offline answers and undo survive reopening; a due timer cannot steal the restored word; reconnect drains exactly once",async()=>{
 const dom=new JSDOM("<!doctype html><body></body>",{url:"https://context-reader.com",pretendToBeVisual:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const factory=new IDBFactory();
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,indexedDB:factory,React}))Object.defineProperty(globalThis,k,{configurable:true,value:v});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
 dom.window.HTMLElement.prototype.scrollTo=()=>{};dom.window.scrollTo=()=>{};dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
 const require=createRequire(import.meta.url);require.extensions[".css"]=m=>{m.exports={};};
 const mock=(p:string,exports:object)=>{const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports} as NodeModule;};
 const owner="00000000-0000-4000-8000-000000000001";
 let online=false;
 Object.defineProperty(dom.window.navigator,"onLine",{configurable:true,get:()=>online});
 mock("../components/AccountProvider",{useAccount:()=>({account:{profile:online?{userId:owner}:null},localAccount:{userId:owner},isOffline:!online,syncNow:async()=>({pushedCount:0,pulledCount:0}),refreshAccount:async()=>{}})});
 mock("../components/useStudyVocabularyEntries",{useStudyVocabularyEntries:(e:unknown[])=>e??[]});
 mock("../components/useStudyTimer",{useStudyTimer:()=>()=>2000});
 mock("../components/StudyWord",{StudyWord:({entry}:{entry:{word:string}})=><div>{entry.word} answer</div>});
 mock("../components/StudyDictionaryHint",{StudyDictionaryHint:()=>null});mock("../components/BookDictionary",{BookDictionary:()=>null});
 for(const n of ["StudyRewards","StudySettings","StudyVocabulary","StudyStats"])mock("../components/"+n,{[n]:()=>null});
 const now=new Date(),ids=["a".repeat(40),"b".repeat(40)];
 let server={offlinePermit:"signed",serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards:ids.map((id,i)=>({id,entry_id:["alpha","beta"][i],mode:"basic_en_to_cn",memory:{...newMemory(now),state:i?3:2,stability:5,difficulty:5,reps:3,last_review:new Date(now.getTime()-86400000).toISOString(),due:new Date(now.getTime()+(i?60000:-1000)).toISOString()},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()})),entries:["alpha","beta"].map(word=>({id:word,word,sourceSentence:"",basicMeaning:"释义",contextMeaning:"释义",anki:{cardMode:"basic_en_to_cn"}})),today:{day:shanghaiDay(now),card_ids:ids,new_ids:[],settings:DEFAULT_STUDY_SETTINGS,reward_points:0,completed_at:null},reviews:[],daily:[],policy:{},streak:{current:0,best:0,last_day:null},rewards:[],claims:[]} as unknown as StudySnapshot;
 await updateStudyLocalRecord(owner,()=>({owner,base:server,events:[]}));
 const received=new Set<string>(),networkEvents:string[]=[];
 let dropFirstResponse=true;
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  if(!online)throw new TypeError("offline");
  const b=init?.body?JSON.parse(String(init.body)):{};
  if(b.op==="local_event"){
   const e=b.event as StudyLocalEvent;networkEvents.push(e.id);
   if(!received.has(e.id)){server=applyLocalStudyEvent(server,e);received.add(e.id);}
   if(dropFirstResponse){dropFirstResponse=false;throw new TypeError("response lost after commit");}
   const r=server.reviews.find(r=>r.id===(e.kind==="undo"?e.reviewId:e.id));
   return Response.json({ack:{id:e.id,serverNow:new Date().toISOString(),outcome:{saved:true},card:server.cards.find(c=>c.id===r?.card_id),review:r,today:server.today}});
  }
  return Response.json({...server,serverNow:new Date().toISOString()});
 };
 const {StudyPanel}=await import("../components/StudyPanel");
 const {render,fireEvent,waitFor,act,cleanup}=await import("@testing-library/react");
 const props={visible:true,onClose(){},onSource(){},notice:""};
 let ui=render(<StudyPanel {...props}/>);
 try{
  await ui.findByText("alpha");
  server.cards[1].memory.due=new Date(Date.now()+1300).toISOString();
  await updateStudyLocalRecord(owner,r=>({...r!,base:{...r!.base,cards:server.cards}}));
  fireEvent.click(ui.getByRole("button",{name:/不记得/}));
  await waitFor(()=>assert.equal(ui.getByRole("button",{name:"下一个"}).hasAttribute("disabled"),false));
  fireEvent.click(ui.getByRole("button",{name:"下一个"}));
  await waitFor(async()=>assert.equal((await updateStudyLocalRecord(owner,r=>r))?.events.length,1));
  await waitFor(()=>assert.equal(ui.getByRole("button",{name:"回到上一张"}).hasAttribute("disabled"),false));
  fireEvent.click(ui.getByRole("button",{name:"回到上一张"}));
  await ui.findByText("alpha");
  await act(async()=>{await new Promise(r=>setTimeout(r,1800));});
  assert.ok(ui.getByText("alpha"));assert.equal(ui.queryByText("beta"),null);
  assert.equal(ui.queryByText(/网络未连接|当前离线|正在核对最新进度/),null);
  ui.unmount();ui=render(<StudyPanel {...props}/>);
  await ui.findByText("beta"); // reopening legitimately selects the now-due learning card
  assert.equal((await updateStudyLocalRecord(owner,r=>r))?.events.length,2);
  await act(async()=>{online=true;dom.window.dispatchEvent(new dom.window.Event("online"));});
  await waitFor(()=>assert.equal(received.size,1));
  assert.equal((await updateStudyLocalRecord(owner,r=>r))?.events.length,2);
  await act(async()=>{await new Promise(r=>setTimeout(r,30));dom.window.dispatchEvent(new dom.window.Event("online"));});
  await waitFor(async()=>assert.equal((await updateStudyLocalRecord(owner,r=>r))?.events.length,0),{timeout:4000});
  assert.equal(received.size,2);assert.equal(networkEvents.length,3);assert.equal(networkEvents[0],networkEvents[1]);assert.equal(server.reviews[0].undone,true);
 }finally{cleanup();globalThis.fetch=original;dom.window.close();}
});
