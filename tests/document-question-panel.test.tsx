import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import DocumentQuestionPanel from "../components/DocumentQuestionPanel";
import { documentQuestionScope, saveDocumentQuestion } from "../lib/documentQuestionHistory";
import type { ImportedArticle } from "../types/article";

test("question panel restores paper history across selection changes and remounts, and defaults to automatic search", async () => {
  const dom=new JSDOM("<html><body></body></html>",{url:"http://localhost"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,indexedDB:new IDBFactory(),React});
  const {render,fireEvent,waitFor,cleanup}=await import("@testing-library/react");
  const article={title:"Paper",document:{id:"pdf-a",name:"a.pdf",format:"pdf",pageCount:1},blocks:[],text:"",url:"",siteName:""} as ImportedArticle;
  const row={id:"old",createdAt:"2026-11-06T00:00:00Z",question:"Saved question",answer:"Saved answer"};
  await saveDocumentQuestion(documentQuestionScope("owner", "pdf-a"),row);
  const oldFetch=globalThis.fetch;
  let body:Record<string,unknown>={};
  globalThis.fetch=async (_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({answer:"New answer",sources:[],searchNotice:"Retrieved reference"});};
  try{
    const view=render(<DocumentQuestionPanel owner="owner" article={article} context={null}/>);
    await waitFor(()=>assert.ok(view.getByText("Saved answer")));
    view.rerender(<DocumentQuestionPanel owner="owner" article={article} context={{word:"acid",sentence:"Acid is discussed.",previousSentence:"",nextSentence:"",paragraphIndex:0,tokenIndex:0}}/>);
    assert.ok(view.getByText("Saved answer"));
    fireEvent.change(view.getByRole("textbox",{name:"向 AI 提问这篇文档"}),{target:{value:"What is it?"}});
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(()=>assert.ok(view.getByText("New answer")));
    await waitFor(()=>assert.ok(view.getByRole("button",{name:"发送问题"})));
    assert.equal(body.autoSearch,true);assert.equal(body.searchQuery,undefined);
    assert.equal((body.history as unknown[]).length,1);
    view.unmount();
    const reopened=render(<DocumentQuestionPanel owner="owner" article={article} context={null}/>);
    await waitFor(()=>assert.ok(reopened.getByText("New answer")));
    reopened.rerender(<DocumentQuestionPanel owner="other" article={article} context={null}/>);
    await waitFor(()=>assert.equal(reopened.queryByText("New answer"),null));
  }finally{globalThis.fetch=oldFetch;cleanup();dom.window.close();}
});
