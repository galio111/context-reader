import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

test("new document lookups scroll below expanded questions immediately, without moving the paper", async () => {
  const dom=new JSDOM("<body></body>",{url:"https://context-reader.com"});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent,HTMLElement:dom.window.HTMLElement,React});
  const require=createRequire(import.meta.url);
  const oldCss=require.extensions[".css"];
  require.extensions[".css"]=module=>{module.exports={};};
  const {ExplanationPanel}=await import("../components/ExplanationPanel");
  const {DocumentSelectionTranslation}=await import("../components/DocumentSelectionTranslation");
  const {render,cleanup}=await import("@testing-library/react");
  const scrolls:number[]=[];
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
    return {top:this.hasAttribute("data-document-lookup-start")?600:0,left:0,right:400,bottom:800,width:400,height:800,x:0,y:0,toJSON(){}};
  };
  dom.window.HTMLElement.prototype.scrollTo=function(options:ScrollToOptions|number){
    assert.ok(this.classList.contains("cr-reader-panel"));
    scrolls.push(typeof options==="number"?options:options.top ?? 0);
  };
  const context={word:"material",sentence:"The material is strong.",previousSentence:"",nextSentence:"",paragraphIndex:0,tokenIndex:0};
  const questions=<details open><summary>继续问 AI</summary><p>Long question history</p></details>;
  try {
    const props={explanation:null,selectedContext:context,loading:true,error:"",isInVocabulary:false,onAddToVocabulary:()=>{},documentMode:true,documentQuestion:questions};
    const view=render(<ExplanationPanel {...props}/>);
    assert.equal(scrolls.at(-1),580);
    scrolls.length=0;
    view.rerender(<ExplanationPanel {...props} selectedContext={{...context,word:"strong"}}/>);
    assert.equal(scrolls.at(-1),580);
    assert.equal(view.container.querySelector<HTMLElement>("[data-document-lookup-start]")?.style.minHeight,"100%");
    view.unmount();
    scrolls.length=0;
    const passage=render(<DocumentSelectionTranslation context={context} result={{text:"",loading:true,notice:"",retry:()=>{}}} documentQuestion={questions}/>);
    assert.equal(scrolls.at(-1),580);
    assert.ok(passage.getByText("正在翻译…"));
  } finally { cleanup();require.extensions[".css"]=oldCss;dom.window.close(); }
});
