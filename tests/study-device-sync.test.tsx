import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import * as React from 'react';
import {useStudyOffline} from '../components/useStudyOffline';
import {updateStudyLocalRecord} from '../lib/studyOfflineStore';
import {DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay} from '../lib/studyScheduler';
import type {StudySnapshot} from '../types/study';

test('remote progress refreshes on focus and visible polling; unchanged polls stay small and pending answers win',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://context-reader.com',pretendToBeVisual:true});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,indexedDB:new IDBFactory(),React,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 const {renderHook,act,waitFor,cleanup}=await import('@testing-library/react');
 const realInterval=globalThis.setInterval,realClear=globalThis.clearInterval;
 let poll:()=>void=()=>{};
 globalThis.setInterval=((fn:()=>void,ms:number)=>{if(ms===10000){poll=fn;return 123456;}return realInterval(fn,ms);}) as typeof setInterval;
 globalThis.clearInterval=((id:ReturnType<typeof setInterval>)=>{if(Number(id)!==123456)realClear(id);}) as typeof clearInterval;
 const owner='device-sync-test',now=new Date();
 let server={offlinePermit:'signed',serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards:[{id:'a',entry_id:'a',mode:'basic_en_to_cn',memory:newMemory(now),version:0,suspended:false,anki_pending:false,created_at:now.toISOString()}],entries:[],today:{day:shanghaiDay(now),card_ids:['a'],new_ids:['a'],settings:DEFAULT_STUDY_SETTINGS},reviews:[],daily:[],claims:[],rewards:[],policy:{},streak:{current:0,best:0,last_day:null}} as unknown as StudySnapshot;
 await updateStudyLocalRecord(owner,()=>({owner,base:server,events:[]}));
 let revision='0',reads=0,probes=0,accepted:StudySnapshot|undefined,release:(()=>void)|undefined,hold=false;
 const network=async<T,>(body?:unknown):Promise<T>=>{
  const op=(body as {op:string}).op;
  if(op==='local_revision'){probes++;return {revision} as T;}
  if(op==='local_event')throw new TypeError('offline upload');
  assert.equal(op,'local_refresh');reads++;
  const response=structuredClone(server);response.serverNow=new Date(Date.now()+reads).toISOString();
  if(hold)await new Promise<void>(resolve=>{release=resolve;});
  return response as T;
 };
 const advance=()=>{revision=String(Number(revision)+1);server={...server,cards:server.cards.map(c=>({...c,version:c.version+1}))};};
 try{
  const hook=renderHook(({active})=>useStudyOffline(owner,network,s=>{accepted=s;},active),{initialProps:{active:true}});
  await waitFor(()=>assert.equal(accepted?.cards[0].version,0));
  advance();await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'));});
  await waitFor(()=>assert.equal(accepted?.cards[0].version,1));
  const priorReads=reads,priorProbes=probes;
  await act(async()=>{poll();});await waitFor(()=>assert.equal(probes,priorProbes+1));
  assert.equal(reads,priorReads,'unchanged idle poll downloads no snapshot');
  advance();await act(async()=>{poll();});await waitFor(()=>assert.equal(accepted?.cards[0].version,2));
  Object.defineProperty(dom.window.document,'visibilityState',{configurable:true,value:'hidden'});
  const hiddenProbes=probes;await act(async()=>{poll();});assert.equal(probes,hiddenProbes);
  Object.defineProperty(dom.window.document,'visibilityState',{configurable:true,value:'visible'});
  advance();hold=true;await act(async()=>{poll();});await waitFor(()=>assert.ok(release));
  await act(async()=>{await hook.result.current.api({op:'review',id:'pending-answer',cardId:'a',answer:'forgot',activeMs:1000});});
  await act(async()=>{release!();});
  await waitFor(async()=>assert.equal((await updateStudyLocalRecord(owner,r=>r))?.events.length,1));
  const record=await updateStudyLocalRecord(owner,r=>r);assert.equal(record?.base.cards[0].version,2,'in-flight snapshot must not replace base after a local answer');
  hook.rerender({active:false});
  const closedProbes=probes;await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'));});assert.equal(probes,closedProbes);
 }finally{cleanup();globalThis.setInterval=realInterval;globalThis.clearInterval=realClear;dom.window.close();}
});

