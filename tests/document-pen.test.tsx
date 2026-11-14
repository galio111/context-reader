import test from "node:test";
import assert from "node:assert/strict";
import React,{useRef} from "react";
import {JSDOM} from "jsdom";
import {IDBFactory} from "fake-indexeddb";
import {captureDocumentPenRects,paintDocumentPen,documentPenKey,readDocumentPenMarks} from "../lib/documentPen";
import {useDocumentPen} from "../components/useDocumentPen";
import {initializeLearningStorage,getLearningStorage,flushLearningStorage} from "../lib/learningStorage";

test("PDF/Word pen rectangles survive scaling and repaint, ignore empty selections and isolate storage",()=>{
 const dom=new JSDOM('<div id="root"><section><div data-document-page="1">A sentence.</div></section></div>');
 const root=dom.window.document.getElementById('root')!;const page=root.firstElementChild as HTMLElement;
 page.getBoundingClientRect=()=>({left:10,top:20,right:410,bottom:820,width:400,height:800} as DOMRect);
 const range=dom.window.document.createRange();range.selectNodeContents(page.querySelector('div')!);
 Object.assign(range,{getClientRects:()=>[{left:50,top:100,right:250,bottom:120,width:200,height:20}]});
 dom.window.document.getSelection()!.addRange(range);
 const rects=captureDocumentPenRects(root);assert.equal(rects.length,1);assert.equal(rects[0].x,.1);assert.equal(rects[0].width,.5);
 paintDocumentPen(root,[{id:'a',rects}]);paintDocumentPen(root,[{id:'a',rects}]);
 assert.equal(root.querySelectorAll('[data-document-pen-layer]').length,1);
 assert.equal((root.querySelector('i') as HTMLElement).style.width,'50%');
 const word=page.querySelector('div')!;word.removeAttribute('data-document-page');page.className='docx';
 assert.equal(captureDocumentPenRects(root)[0].page,'word:0');
 dom.window.document.getSelection()!.removeAllRanges();assert.deepEqual(captureDocumentPenRects(root),[]);
 const data=new Map<string,string>();const store={getItem:(key:string)=>data.get(key)??null};
 data.set(documentPenKey('one','pdf'),JSON.stringify([{id:'a',rects}]));
 assert.equal(readDocumentPenMarks(store,documentPenKey('one','pdf')).length,1);
 assert.equal(readDocumentPenMarks(store,documentPenKey('two','pdf')).length,0);
 data.set('bad','{"invalid":true}');assert.throws(()=>readDocumentPenMarks(store,'bad'));
 dom.window.close();
});

test("pen mode intercepts lookup, persists and restores marks, supports undo and normal lookup after switching off",async()=>{
 const dom=new JSDOM('',{url:'https://context-reader.com',pretendToBeVisual:true});
 Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),indexedDB:new IDBFactory()});
 Object.defineProperty(dom.window,'indexedDB',{value:globalThis.indexedDB});
 await initializeLearningStorage();getLearningStorage().setItem('context-reader:local-account-owner:v1','one');
 const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');let lookups=0;
 function Harness(){const root=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null);const pen=useDocumentPen('paper',root,frame,true,'1');return <><button onClick={pen.toggle}>toggle</button><button onClick={()=>{if(!pen.capture())lookups++;}}>select</button><button onClick={pen.undo}>undo</button><output>{pen.count}</output><div ref={root}><section><div data-document-page="1">A sentence.</div></section></div></>;}
 try{
  let view=render(<Harness/>);fireEvent.click(view.getByText('select'));assert.equal(lookups,1);
  fireEvent.click(view.getByText('toggle'));
  const page=view.container.querySelector('section')!;page.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:800,width:400,height:800} as DOMRect);
  const range=dom.window.document.createRange();range.selectNodeContents(page.querySelector('div')!);Object.assign(range,{getClientRects:()=>[{left:10,top:20,right:210,bottom:40,width:200,height:20}]});dom.window.document.getSelection()!.addRange(range);
  fireEvent.click(view.getByText('select'));assert.equal(lookups,1);await waitFor(()=>assert.equal(view.container.querySelector('output')?.textContent,'1'));
  await flushLearningStorage();view.unmount();view=render(<Harness/>);
  await waitFor(()=>assert.equal(view.container.querySelector('output')?.textContent,'1'));
  fireEvent.click(view.getByText('select'));assert.equal(lookups,2);
  fireEvent.click(view.getByText('undo'));await waitFor(()=>assert.equal(view.container.querySelector('output')?.textContent,'0'));
 }finally{cleanup();dom.window.close();}
});
