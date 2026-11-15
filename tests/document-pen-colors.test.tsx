import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React, { useRef } from "react";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { DOCUMENT_PEN_COLORS, documentPenKey, paintDocumentPen, readDocumentPenMarks, type DocumentPenMark } from "../lib/documentPen";
import { useDocumentPen } from "../components/useDocumentPen";
import { initializeLearningStorage, getLearningStorage, flushLearningStorage } from "../lib/learningStorage";

test("PDF and Word replay legacy red and per-stroke colors in draw order without rewriting marks", () => {
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.getElementById('root')!;
  for(const pdf of [true,false]){
    root.innerHTML=pdf?'<section><div data-document-page="1"></div></section>':'<section class="docx"></section>';
    const rects=[{page:pdf?'pdf:1':'word:0',x:.1,y:.2,width:.4}];
    const marks:DocumentPenMark[]=[{id:'legacy',rects},{id:'blue',rects,color:'blue'},{id:'yellow',rects,color:'yellow'},{id:'red-again',rects,color:'red'}];
    const original=JSON.stringify(marks);
    const read=readDocumentPenMarks({getItem:()=>original},'test');
    paintDocumentPen(root,read);paintDocumentPen(root,read);
    assert.equal(root.querySelectorAll('[data-document-pen-layer]').length,1);
    assert.deepEqual([...root.querySelectorAll<HTMLElement>('i')].map(line=>line.dataset.documentPenColor),['red','blue','yellow','red']);
    for(const line of root.querySelectorAll<HTMLElement>('i')){
      const expected=dom.window.document.createElement('i');expected.style.background=DOCUMENT_PEN_COLORS[line.dataset.documentPenColor as keyof typeof DOCUMENT_PEN_COLORS].stroke;
      assert.equal(line.style.background,expected.style.background);
    }
    assert.equal(JSON.stringify(read),original);
    assert.throws(()=>readDocumentPenMarks({getItem:()=>JSON.stringify([{id:'bad',rects,color:'url(example)'}])},'test'));
  }
  dom.window.close();
});

test("same-color overlap still unions while different colors retain their visible boundaries",()=>{
  const dom=new JSDOM('<div id="root"><section><div data-document-page="1"></div></section></div>'),root=dom.window.document.getElementById('root')!;
  const a={page:'pdf:1',x:.1,y:.2,width:.2},b={...a,x:.2};
  paintDocumentPen(root,[{id:'a',color:'blue',rects:[a]},{id:'b',color:'blue',rects:[b]},{id:'c',color:'yellow',rects:[b]}]);
  const lines=root.querySelectorAll<HTMLElement>('i');assert.equal(lines.length,2);assert.equal(lines[0].dataset.documentPenColor,'blue');assert.ok(Math.abs(parseFloat(lines[0].style.width)-30)<.001);assert.equal(lines[1].dataset.documentPenColor,'yellow');
  dom.window.close();
});

test("three color controls enable drawing, persist new stroke colors, replay and undo for PDF/Word",async()=>{
  const dom=new JSDOM('',{url:'https://context-reader.com',pretendToBeVisual:true});
  Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),indexedDB:new IDBFactory()});
  Object.defineProperty(dom.window,'indexedDB',{value:globalThis.indexedDB});
  await initializeLearningStorage();getLearningStorage().setItem('context-reader:local-account-owner:v1','colors-owner');
  const require=createRequire(import.meta.url),previous=require.extensions['.css'];require.extensions['.css']=module=>{module.exports={};};
  const {DocumentPenColors}=await import('../components/DocumentPenColors');
  const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
  let lookups=0;
  function Harness({pdf}:{pdf:boolean}){
    const root=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),pen=useDocumentPen(pdf?'pdf-paper':'word-paper',root,frame,pdf,'1');
    return <><DocumentPenColors color={pen.color} disabled={!pen.ready} onChange={pen.selectColor}/><button onClick={()=>{if(!pen.capture())lookups++;}}>select</button><button onClick={pen.undo}>undo</button><output>{pen.count}</output><div ref={root}>{pdf?<section><div data-document-page="1">A sentence.</div></section>:<iframe ref={frame}/>}</div></>;
  }
  try{
    for(const pdf of [true,false]){
      let ui=render(<Harness pdf={pdf}/>);
      function page(){
        if(!pdf){const doc=ui.container.querySelector('iframe')!.contentDocument!;if(!doc.querySelector('section'))doc.body.innerHTML='<section class="docx">A sentence.</section>';return doc.querySelector('section')!;}
        return ui.container.querySelector('section')!;
      }
      function select(){const p=page();p.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:800,width:400,height:800} as DOMRect);const range=p.ownerDocument.createRange();range.selectNodeContents(p);Object.assign(range,{getClientRects:()=>[{left:10,top:20,right:210,bottom:40,width:200,height:20}]});p.ownerDocument.getSelection()!.removeAllRanges();p.ownerDocument.getSelection()!.addRange(range);fireEvent.click(ui.getByText('select'));}
      await waitFor(()=>assert.equal(ui.getByRole('button',{name:'红色画笔'}).hasAttribute('disabled'),false));
      assert.equal(ui.getByRole('button',{name:'红色画笔'}).getAttribute('aria-pressed'),'true');
      for(const [i,name] of ['蓝色画笔','黄色画笔','红色画笔'].entries()){
        fireEvent.click(ui.getByRole('button',{name}));assert.equal(ui.getByRole('button',{name}).getAttribute('aria-pressed'),'true');select();
        await waitFor(()=>assert.equal(ui.container.querySelector('output')?.textContent,String(i+1)));
      }
      select();assert.equal(ui.container.querySelector('output')?.textContent,'3','same color and same selection is deduplicated');
      await flushLearningStorage();const key=documentPenKey('colors-owner',pdf?'pdf-paper':'word-paper');
      assert.deepEqual(readDocumentPenMarks(getLearningStorage(),key).map(mark=>mark.color),['blue','yellow','red']);
      ui.unmount();ui=render(<Harness pdf={pdf}/>);page();
      await waitFor(()=>assert.equal(ui.container.querySelector('output')?.textContent,'3'));
      await waitFor(()=>assert.deepEqual([...page().querySelectorAll<HTMLElement>('i')].map(line=>line.dataset.documentPenColor),['blue','yellow','red']));
      fireEvent.click(ui.getByText('undo'));await waitFor(()=>assert.equal(ui.container.querySelector('output')?.textContent,'2'));
      assert.deepEqual(readDocumentPenMarks(getLearningStorage(),key).map(mark=>mark.color),['blue','yellow']);
      const before=lookups;fireEvent.click(ui.getByText('select'));assert.equal(lookups,before+1,'reopening keeps normal lookup until pen/color is chosen');
      ui.unmount();
    }
  }finally{cleanup();require.extensions['.css']=previous;dom.window.close();}
});
