import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {JSDOM} from "jsdom";
import * as React from "react";
import {useDocumentScrollLock} from "../components/useDocumentScrollLock";
test("overlapping import, Menu and image locks release in either order and on unmount", async () => {
 const dom = new JSDOM('<!doctype html><body></body>',{url:'https://context-reader.com',pretendToBeVisual:true});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,React,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 dom.window.scrollTo=()=>{};
 const {render,cleanup}=await import('@testing-library/react');
 function Layer({active}:{active:boolean}) {useDocumentScrollLock(active);return null;}
 try {
  for(let repeat=0;repeat<10;repeat++) {
   const ui=render(<><Layer active/><Layer active/></>);
   assert.equal(document.body.style.position,'fixed');
   ui.rerender(<><Layer active={repeat%2===0}/><Layer active={repeat%2!==0}/></>);
   assert.equal(document.documentElement.style.overflow,'hidden');
   ui.rerender(<><Layer active={false}/><Layer active={false}/></>);
   assert.equal(document.documentElement.style.overflow,'');
   assert.equal(document.body.style.position,'');
   assert.equal(document.body.style.overflow,'');
   ui.rerender(<><Layer active/><Layer active/></>);
   ui.unmount();
   assert.equal(document.documentElement.style.overflow,'');
   assert.equal(document.body.style.position,'');
  }
  const reader=readFileSync(new URL('../components/ReaderView.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(reader,/document\.(?:documentElement|body)\.style\.overflow\s*=/,'Reader overlays must share the lock manager, never restore stale hidden snapshots');
 } finally {cleanup();dom.window.close();}
});
