import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as React from 'react';
import {DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay} from '../lib/studyScheduler';
import type {StudySnapshot} from '../types/study';

test('finished budget shows completion, hides backlog, and only explicit extra admits more old words',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://context-reader.com',pretendToBeVisual:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,Event:dom.window.Event,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,React}))Object.defineProperty(globalThis,key,{configurable:true,value});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 dom.window.HTMLElement.prototype.scrollTo=()=>{};dom.window.scrollTo=()=>{};
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
 const require=createRequire(import.meta.url);require.extensions['.css']=m=>{m.exports={};};
 const mock=(path:string,exports:object)=>{const filename=require.resolve(path);require.cache[filename]={id:filename,filename,loaded:true,exports} as NodeModule;};
 const owner='00000000-0000-4000-8000-000000000001';
 mock('../components/AccountProvider',{useAccount:()=>({account:{profile:{userId:owner}},isOffline:false,syncNow:async()=>null,refreshAccount:async()=>{}})});
 mock('../components/useStudyVocabularyEntries',{useStudyVocabularyEntries:(e:unknown[])=>e??[]});
 mock('../components/StudyDictionaryHint',{StudyDictionaryHint:()=>null});mock('../components/BookDictionary',{BookDictionary:()=>null});
 for(const name of ['StudyRewards','StudyVocabulary','StudyStats'])mock('../components/'+name,{[name]:()=>null});
 const {StudyPanel}=await import('../components/StudyPanel');const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
 const now=new Date(),day=shanghaiDay(now),ids=Array.from({length:46},(_,i)=>String(i).padStart(40,'0'));
 const cards=ids.map((id,i)=>({id,entry_id:'word'+i,mode:'basic_en_to_cn',memory:{...newMemory(now),state:i===45?0:2,last_review:i<40?now.toISOString():new Date(now.getTime()-86400000).toISOString(),due:new Date(now.getTime()+(i<40?7:-1)*86400000).toISOString()},version:1,suspended:false,anki_pending:false,created_at:now.toISOString()}));
 let seed={serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards,entries:cards.map(c=>({id:c.entry_id,word:c.entry_id,sourceSentence:'',anki:{cardMode:'basic_en_to_cn'}})),today:{day,card_ids:[...ids.slice(0,40),ids[45]],new_ids:[ids[45]],settings:DEFAULT_STUDY_SETTINGS,reward_points:0,completed_at:null},reviews:[],daily:[],policy:{},streak:{current:0,best:0,last_day:null},rewards:[],claims:[]} as unknown as StudySnapshot;
 const originalFetch=globalThis.fetch;let settingsCalls=0;
 globalThis.fetch=async(_url,init)=>{const body=init?.body?JSON.parse(String(init.body)):null;
  if(body?.op==='present')return Response.json({token:'00000000-0000-4000-8000-000000000099'});
  if(body?.op==='settings'){settingsCalls++;seed={...seed,settings:body.settings,today:{...seed.today!,card_ids:ids,settings:body.settings}};}
  return Response.json({...seed,serverNow:new Date().toISOString()});};
 try{
  const ui=render(<StudyPanel visible onClose={()=>{}} onSource={()=>{}} notice=""/>);
  await ui.findByRole('heading',{name:'今日复习完成'});
  assert.equal(ui.queryByRole('button',{name:/不记得/}),null);
  assert.equal(ui.getByText('复习安排详情').closest('details')?.open,false);
  fireEvent.click(ui.getByText('复习安排详情'));fireEvent.click(ui.getByRole('button',{name:'今天再复习 10 个'}));
  await waitFor(()=>assert.equal(settingsCalls,1));await waitFor(()=>assert.equal(ui.queryByRole('heading',{name:'今日复习完成'}),null));
  assert.ok(await ui.findByRole('button',{name:/不记得/}));assert.equal(seed.settings.reviewExtraCount,10);
  fireEvent.click(ui.getByRole('button',{name:'设置',exact:true}));
  assert.equal((ui.getByLabelText('每日最多复习') as HTMLInputElement).value,'40');
 }finally{cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
