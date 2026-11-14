import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import DocumentQuestionPanel from "../components/DocumentQuestionPanel";
import { documentQuestionScope, saveDocumentQuestion, mergeDocumentQuestionObjects,documentQuestionObjectKey } from "../lib/documentQuestionHistory";
import type { ImportedArticle } from "../types/article";

test("question panel restores paper history across selection changes and remounts, and defaults to automatic search", async () => {
  const dom=new JSDOM("<html><body></body></html>",{url:"http://localhost"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent,HTMLElement:dom.window.HTMLElement,indexedDB:new IDBFactory(),React});
  const {render,fireEvent,waitFor,cleanup,act}=await import("@testing-library/react");
  const article={title:"Paper",document:{id:"pdf-a",name:"a.pdf",format:"pdf",pageCount:1},blocks:[],text:"",url:"",siteName:""} as ImportedArticle;
  const row={id:"old",createdAt:"2026-11-06T00:00:00Z",question:"Saved question",answer:"Saved answer"};
  await saveDocumentQuestion(documentQuestionScope("owner", "pdf-a"),row);
  const oldFetch=globalThis.fetch;
  const scrolls:{id:string|null;top:number}[]=[];
  dom.window.HTMLElement.prototype.scrollTo=function(options:ScrollToOptions|number){
    scrolls.push({id:this.getAttribute("aria-label"),top:typeof options === "number"?options:options.top ?? 0});
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
    const index=Array.from(this.parentElement?.children ?? []).indexOf(this);
    return {top:this.hasAttribute("data-question-id")?index*400:0,left:0,right:400,bottom:600,width:400,height:600,x:0,y:0,toJSON(){}};
  };
  let releaseAnswer:((value:Response)=>void)|undefined;
  let requestSignal:AbortSignal|null|undefined;
  let body:Record<string,unknown>={};
  globalThis.fetch=async (_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({answer:"New answer",sources:[{title:"Source that should stay hidden",url:"https://example.org"}],searchNotice:""});};
  try{
    const view=render(<DocumentQuestionPanel owner="owner" article={article} context={null}/>);
    await waitFor(()=>assert.ok(view.getByText("Saved answer")));
    const details=view.container.querySelector("details")!;
    fireEvent.click(view.getByText(/继续问 AI/));
    details.open=true;
    const marker=view.getByRole("button",{name:"跳转到问题 1：Saved question"});
    fireEvent.pointerEnter(marker);
    assert.equal(view.getByRole("tooltip").textContent,"Saved question");
    fireEvent.click(marker);
    assert.equal(view.queryByRole("tooltip"),null);
    assert.ok(view.container.querySelector("form")!.compareDocumentPosition(view.getByLabelText("文档问答历史")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(view.queryByRole("checkbox"),null);
    assert.equal(view.queryByRole("textbox",{name:"外部资料检索关键词"}),null);
    view.rerender(<DocumentQuestionPanel owner="owner" article={article} context={{word:"acid",sentence:"Acid is discussed.",previousSentence:"",nextSentence:"",paragraphIndex:0,tokenIndex:0}}/>);
    assert.ok(view.getByText("Saved answer"));
    fireEvent.change(view.getByRole("textbox",{name:"向 AI 提问这篇文档"}),{target:{value:"What is it?"}});
    const input=view.getByRole("textbox",{name:"向 AI 提问这篇文档"});
    fireEvent.keyDown(input,{key:"Enter",shiftKey:true});
    assert.deepEqual(body,{});
    fireEvent.keyDown(input,{key:"Enter",isComposing:true});
    assert.deepEqual(body,{});
    fireEvent.keyDown(input,{key:"Enter"});
    await waitFor(()=>assert.ok(view.getByText("New answer")));
    await waitFor(()=>assert.ok(view.getByRole("button",{name:"发送问题"})));
    assert.equal(view.queryByText("Source that should stay hidden"),null);
    assert.ok(scrolls.some(call=>call.id==="文档问答历史" && call.top===400));
    assert.equal(body.autoSearch,true);assert.equal(body.searchQuery,undefined);
    assert.equal((body.history as unknown[]).length,1);
    // Start a delayed question, hide/unmount its only view, then restore it.
    globalThis.fetch=async (_url,init)=>{
      requestSignal=init?.signal;
      return new Promise<Response>(resolve=>{releaseAnswer=resolve;});
    };
    fireEvent.change(view.getByRole("textbox",{name:"向 AI 提问这篇文档"}),{target:{value:"Background follow-up?"}});
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(()=>assert.ok(releaseAnswer));
    assert.ok(view.getByText("Background follow-up?",{selector:"h3"}));
    details.open=false;
    view.unmount();
    assert.equal(requestSignal?.aborted,false);
    const waiting=render(<DocumentQuestionPanel owner="owner" article={article} context={null}/>);
    await waitFor(()=>assert.ok(waiting.getByText("Background follow-up?",{selector:"h3"})));
    assert.equal((waiting.getByRole("textbox",{name:"向 AI 提问这篇文档",hidden:true}) as HTMLTextAreaElement).value,"Background follow-up?");
    waiting.unmount();
    await act(async()=>{releaseAnswer!(Response.json({answer:"Finished while hidden",sources:[]}));});
    const reopened=render(<DocumentQuestionPanel owner="owner" article={article} context={null}/>);
    await waitFor(()=>assert.ok(reopened.getByText("Finished while hidden")));
    await waitFor(()=>assert.ok(reopened.getByText("New answer")));
    const cloud={documentId:"pdf-a",turn:{...row,id:"cloud",question:"Remote question",answer:"Remote answer"}};
    await mergeDocumentQuestionObjects("owner",[{kind:"preferences",objectKey:documentQuestionObjectKey(cloud),payload:cloud,clientUpdatedAt:row.createdAt,serverVersion:1}]);
    await waitFor(()=>assert.ok(reopened.getByText("Remote answer")),{timeout:3000});
    reopened.rerender(<DocumentQuestionPanel owner="other" article={article} context={null}/>);
    await waitFor(()=>assert.equal(reopened.queryByText("New answer"),null));
  }finally{globalThis.fetch=oldFetch;cleanup();dom.window.close();}
});
