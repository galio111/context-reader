import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import * as React from "react";
import { matchesStudyVocabulary } from "../lib/studyVocabularySearch";
import type { VocabularyEntry } from "../types/vocabulary";
import type { StudySnapshot } from "../types/study";

const entries = [
  {id:"a",word:"absorb",basicMeaning:"vt. 吸收",contextMeaning:"take in 吸收"},
  {id:"t",word:"Take",basicMeaning:"vt. 拿走",contextMeaning:"拿走"},
  {id:"tr",word:"tree",basicMeaning:"n. 树",contextMeaning:"树木"},
  {id:"c",word:"cat",basicMeaning:"n. 猫",contextMeaning:"猫"},
].map((e,i)=>({...e,createdAt:`2026-01-0${i+1}T00:00:00Z`})) as VocabularyEntry[];

test("one English character matches word prefixes, never embedded letters, POS or definition text",()=>{
  const oldMatches=entries.filter(e=>(e.word+" "+e.basicMeaning+" "+e.contextMeaning).toLowerCase().includes("t"));
  assert.equal(oldMatches.length,4,"reproduces the old unchanged list");
  for(const query of ["t","T"," Ｔ "])assert.deepEqual(entries.filter(e=>matchesStudyVocabulary(e,query)).map(e=>e.word),["Take","tree"]);
  assert.deepEqual(entries.filter(e=>matchesStudyVocabulary(e,"tr")).map(e=>e.word),["tree"]);
  assert.deepEqual(entries.filter(e=>matchesStudyVocabulary(e,"吸收")).map(e=>e.word),["absorb"]);
  assert.equal(entries.filter(e=>matchesStudyVocabulary(e,"   ")).length,4);
  assert.equal(entries.filter(e=>matchesStudyVocabulary(e,"zzzz")).length,0);
  assert.equal(matchesStudyVocabulary({word:"legacy"} as VocabularyEntry,"中文"),false);
});

test("typing, clearing, state filters and sorting update the rendered notebook without changing saved entries",async()=>{
  const dom=new JSDOM("<!doctype html><body></body>",{url:"https://context-reader.com",pretendToBeVisual:true});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const require=createRequire(import.meta.url);require.extensions[".css"]=(module)=>{module.exports={};};
  const {StudyVocabulary}=await import("../components/StudyVocabulary");
  const {render,fireEvent,cleanup}=await import("@testing-library/react");
  const snapshot={entries,cards:[],serverNow:"2026-10-13T00:00:00Z"} as unknown as StudySnapshot;
  const before=JSON.stringify(snapshot);let opened="";
  const ui=render(<StudyVocabulary snapshot={snapshot} onOpen={e=>{opened=e.id;}}/>);
  const words=()=>Array.from(ui.container.querySelectorAll("li strong")).map(e=>e.textContent);
  const search=ui.getByRole("searchbox",{name:"搜索生词"});
  try {
    assert.deepEqual(words(),["absorb","Take","tree","cat"]);
    fireEvent.change(search,{target:{value:"t"}});
    assert.deepEqual(words(),["Take","tree"]);assert.ok(ui.getByText("2 个词"));
    fireEvent.change(search,{target:{value:"tr"}});assert.deepEqual(words(),["tree"]);
    fireEvent.click(ui.getByRole("button",{name:"查看 tree 详情"}));assert.equal(opened,"tr");
    fireEvent.change(search,{target:{value:"zzzz"}});assert.ok(ui.getByText("没有找到这个词"));
    fireEvent.change(search,{target:{value:""}});assert.equal(words().length,4);
    fireEvent.change(search,{target:{value:" Ｔ "}});assert.deepEqual(words(),["Take","tree"]);
    fireEvent.click(ui.getByRole("button",{name:"已学",exact:true}));assert.equal(words().length,0);
    fireEvent.click(ui.getByRole("button",{name:"全部",exact:true}));assert.deepEqual(words(),["Take","tree"]);
    fireEvent.change(search,{target:{value:"树"}});assert.deepEqual(words(),["tree"]);
    fireEvent.change(search,{target:{value:""}});
    fireEvent.click(ui.getByRole("button",{name:"字母 A–Z",exact:true}));assert.deepEqual(words(),["absorb","cat","Take","tree"]);
    assert.equal(JSON.stringify(snapshot),before);
  } finally {cleanup();dom.window.close();}
});

