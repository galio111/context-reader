import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { JSDOM } from "jsdom";
import type { VocabularyEntry } from "../types/vocabulary";
import type { StudyCard, StudySnapshot } from "../types/study";
import { newMemory } from "../lib/studyScheduler";

test("studied categories use the last review, unstudied lists use collection time, and sentences enroll automatically", async t=>{
  const require=createRequire(import.meta.url);
  const css=require.extensions[".css"];require.extensions[".css"]=(m)=>{m.exports={};};
  const account=require.resolve("../components/AccountProvider"), prior=require.cache[account];
  require.cache[account]={id:account,filename:account,loaded:true,exports:{useAccount:()=>({account:{profile:{userId:"test"}},syncNow:async()=>({})})}} as NodeModule;
  const dom=new JSDOM("<body></body>",{url:"https://context-reader.test",pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
  t.after(()=>{if(css)require.extensions[".css"]=css;else delete require.extensions[".css"];if(prior)require.cache[account]=prior;else delete require.cache[account];dom.window.close();});
  const {StudyVocabulary}=await import("../components/StudyVocabulary");
  const {render,fireEvent,cleanup}=await import("@testing-library/react");
  t.after(cleanup);
  const now=new Date("2026-11-21T00:00:00Z");
  const entries:VocabularyEntry[]=[],cards:StudyCard[]=[];
  for(const [index,label] of ["new","learning","review","steady"].entries())for(const [day,word] of [[1,"apple"],[2,"zebra"]] as const){
    const id=label+"-"+word;
    entries.push({id,word:id,contextMeaning:"释义",basicMeaning:"释义",createdAt:`2026-11-0${day}T03:00:00Z`,updatedAt:"2026-11-21",anki:{}} as VocabularyEntry);
    cards.push({id,entry_id:id,memory:{...newMemory(now),state:[0,1,2,2][index],stability:index===3?50:2,last_review:day===1?now.toISOString():"2026-11-19T03:00:00Z"}} as StudyCard);
  }
  entries.push({id:"sentence-x",entryKind:"sentence",sourceSentence:"Practice makes a difference.",sentenceTranslation:"练习带来改变。",createdAt:now.toISOString(),anki:{}} as VocabularyEntry);
  const view=render(<StudyVocabulary snapshot={{entries,cards,serverNow:now.toISOString()} as StudySnapshot} onOpen={()=>{}}/>);
  for(const tab of ["已学","正在背","熟悉","待巩固","未学","全部"]){
    fireEvent.click(view.getByRole("button",{name:"字母 A–Z"}));fireEvent.click(view.getByRole("button",{name:tab}));
    const byStudy=["已学","熟悉","待巩固"].includes(tab);
    assert.equal(view.getByRole("button",{name:byStudy?"最近学习":"收藏顺序"}).getAttribute("aria-pressed"),"true");
    const words=Array.from(view.container.querySelectorAll("li strong")).map(el=>el.textContent!);
    assert.ok(words.length>=2); const firstOld=words.findIndex(s=>s.endsWith(byStudy?"zebra":"apple"));
    assert.ok(firstOld>0 && words.slice(0,firstOld).every(s=>s.endsWith(byStudy?"apple":"zebra")) && words.slice(firstOld).every(s=>s.endsWith(byStudy?"zebra":"apple")),tab);
    assert.equal(view.queryByText("练习带来改变。"),null);
  }
  fireEvent.click(view.getByRole("button",{name:"已学"}));
  const updated=cards.map(card=>card.id==="review-zebra"?{...card,memory:{...card.memory,last_review:new Date(now.getTime()+1000).toISOString()}}:card);
  view.rerender(<StudyVocabulary snapshot={{entries,cards:updated,serverNow:new Date(now.getTime()+1000).toISOString()} as StudySnapshot} onOpen={()=>{}}/>);
  assert.equal(view.container.querySelector("li strong")?.textContent,"review-zebra");
  fireEvent.click(view.getByRole("button",{name:"好句"}));assert.ok(view.getByText("练习带来改变。"));
  assert.equal(view.queryByRole("button",{name:"加入背诵"}),null);assert.equal(view.queryByText("new-apple"),null);
});
