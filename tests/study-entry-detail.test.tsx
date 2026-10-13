import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import * as React from "react";
import type { VocabularyEntry } from "../types/vocabulary";

test("summary details are deduplicated, scoped to owner and version, and never shown as complete questions", async () => {
  const dom=new JSDOM("<!doctype html><body></body>",{url:"https://context-reader.com"});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const require=createRequire(import.meta.url);
  const mock=(path:string,exports:object)=>{const filename=require.resolve(path);require.cache[filename]={id:filename,filename,loaded:true,exports} as NodeModule;};
  let owner="detail-owner-a",local:VocabularyEntry|undefined;
  mock("../components/AccountProvider",{useAccount:()=>({account:{profile:{userId:owner}},isOffline:false})});
  mock("../lib/standaloneDictionaryHistory",{dictionaryHistoryOwner:()=>owner});
  mock("../lib/vocabularyRepository",{getVocabularyEntry:()=>local});
  const {useStudyEntry,preloadStudyEntry}=await import("../components/useStudyEntry");
  const {render,act,waitFor,cleanup}=await import("@testing-library/react");
  const summary={id:"detail-word",word:"example",updatedAt:"2026-10-13T01:00:00Z",studySummary:true} as unknown as VocabularyEntry;
  const full={...summary,studySummary:undefined,sourceSentence:"A complete source sentence",usageNote:"All saved usage",anki:{cardMode:"cloze_context",clozeSentence:"A complete ________ sentence"}} as VocabularyEntry;
  const originalFetch=globalThis.fetch;
  const calls:Array<{owner:string;resolve:(response:Response)=>void}>=[];
  globalThis.fetch=async(_url,init)=>new Promise<Response>(resolve=>calls.push({owner:new Headers(init?.headers).get("X-Context-Account")!,resolve}));
  function Detail({item}:{item:VocabularyEntry}) {const {entry,error,retry}=useStudyEntry(item);return <div>{entry?.sourceSentence??"loading"}{error&&<button onClick={retry}>retry</button>}</div>;}
  const ui=render(<Detail item={summary}/>);
  try {
    await waitFor(()=>assert.equal(calls.length,1));
    assert.equal(ui.container.textContent,"loading");
    const same=preloadStudyEntry(owner,summary);
    assert.equal(calls.length,1,"prefetch and active detail share one read");
    owner="detail-owner-b";ui.rerender(<Detail item={summary}/>);
    await waitFor(()=>assert.equal(calls.length,2));
    await act(async()=>{calls[0].resolve(Response.json({entry:full}));await same;});
    assert.equal(ui.container.textContent,"loading","the previous account response cannot populate this account");
    await act(async()=>calls[1].resolve(Response.json({error:"missing"},{status:404})));
    await waitFor(()=>assert.ok(ui.getByText("retry")));
    await act(async()=>ui.getByText("retry").click());
    await waitFor(()=>assert.equal(calls.length,3));
    await act(async()=>calls[2].resolve(Response.json({entry:full})));
    await waitFor(()=>assert.equal(ui.container.textContent,full.sourceSentence));
    const newer={...summary,updatedAt:"2026-10-13T02:00:00Z"};
    ui.rerender(<Detail item={newer}/>);
    await waitFor(()=>assert.equal(calls.length,4));
    assert.equal(ui.container.textContent,"loading","old detail never satisfies a changed saved version");
    local={...full,updatedAt:newer.updatedAt,sourceSentence:"New local source"};
    ui.rerender(<Detail item={{...newer}}/>);
    assert.equal(ui.container.textContent,"New local source");
    await act(async()=>calls[3].resolve(Response.json({entry:{...full,updatedAt:newer.updatedAt}})));
    assert.equal(ui.container.textContent,"New local source","late remote read cannot overwrite the newer local display");
    assert.deepEqual(calls.map(c=>c.owner),["detail-owner-a","detail-owner-b","detail-owner-b","detail-owner-b"]);
  } finally {cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
