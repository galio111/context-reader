import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import * as React from 'react';
import type {VocabularyEntry} from '../types/vocabulary';
import {ACCOUNT_DATA_CHANGED_EVENT} from '../lib/accountEvents';
test('new local favourites appear before cloud refresh without crossing account boundaries',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://context-reader.com'});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,React,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 const require=createRequire(import.meta.url);const mock=(path:string,exports:object)=>{const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports} as NodeModule;};
 let activeOwner='alice';const old={id:'old',word:'old',updatedAt:'2026-10-14',createdAt:'2026-10-14'} as VocabularyEntry;
 let locals=[old];mock('../lib/standaloneDictionaryHistory',{dictionaryHistoryOwner:()=>activeOwner});
 mock('../lib/vocabularyRepository',{getVocabularyEntry:(id:string)=>locals.find(e=>e.id===id),getVocabularyEntries:()=>locals});
 const {useStudyVocabularyEntries}=await import('../components/useStudyVocabularyEntries');
 const {render,act,cleanup}=await import('@testing-library/react');
 const entries=[old];function Notebook(){return <div>{useStudyVocabularyEntries(entries,'alice').map(e=>e.word).join(',')}</div>}
 const ui=render(<Notebook/>);
 try{
  assert.equal(ui.container.textContent,'old');locals=[old,{...old,id:'new',word:'new',createdAt:'2026-10-16'}];
  act(()=>window.dispatchEvent(new CustomEvent(ACCOUNT_DATA_CHANGED_EVENT,{detail:{kinds:['vocabulary']}})));
  assert.equal(ui.container.textContent,'old,new');assert.equal(entries.length,1);
  activeOwner='bob';locals=[{...old,id:'private',word:'bob-private'}];ui.rerender(<Notebook/>);
  act(()=>window.dispatchEvent(new CustomEvent(ACCOUNT_DATA_CHANGED_EVENT,{detail:{kinds:['vocabulary']}})));
  assert.ok(!String(ui.container.textContent).includes('bob-private'));
 }finally{cleanup();dom.window.close();}
});

