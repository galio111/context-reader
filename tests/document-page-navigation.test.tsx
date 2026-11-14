import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useRef} from 'react';
import {JSDOM} from 'jsdom';
import {createRequire} from 'node:module';

test('page navigation supports typed jumps, directory selection, invalid input and transient reset',async()=>{
 const dom=new JSDOM('',{url:'http://localhost',pretendToBeVisual:true});Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}} as unknown as typeof ResizeObserver;
 const require=createRequire(import.meta.url);const old=require.extensions['.css'];require.extensions['.css']=module=>{module.exports={};};
 const {DocumentPageNavigation}=await import('../components/DocumentPageNavigation');const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');let jumps=0;
 function Harness({id}:{id:string}){const root=useRef<HTMLDivElement>(null),iframe=useRef<HTMLIFrameElement>(null);return <div ref={root}><div data-document-toolbar><DocumentPageNavigation root={root} iframe={iframe} documentId={id} word={false} revision="1" onJump={()=>jumps++}/></div>{[1,2,3].map(n=><section key={n} ref={el=>{if(el)el.getBoundingClientRect=()=>({top:(n-1)*1000-dom.window.document.documentElement.scrollTop} as DOMRect);}}><div data-document-page={n}/></section>)}</div>;}
 try{
  const view=render(<Harness id="one"/>);await waitFor(()=>assert.match(view.getByLabelText('总页数').textContent??'',/3/));
  fireEvent.change(view.getByLabelText('跳转页码'),{target:{value:'3'}});fireEvent.submit(view.container.querySelector('form')!);assert.equal(jumps,1);assert.equal(dom.window.document.documentElement.scrollTop,1988);
  fireEvent.change(view.getByLabelText('跳转页码'),{target:{value:'9'}});fireEvent.submit(view.container.querySelector('form')!);assert.ok(view.getByRole('status'));assert.equal(jumps,1);
  fireEvent.click(view.getByRole('button',{name:'页目录'}));assert.ok(view.getByRole('dialog',{name:'文档页目录'}));fireEvent.click(view.getByRole('button',{name:'第 2 页'}));assert.equal(jumps,2);assert.equal(dom.window.document.documentElement.scrollTop,988);assert.equal(view.queryByRole('dialog'),null);
  fireEvent.click(view.getByRole('button',{name:'页目录'}));fireEvent.keyDown(dom.window,{key:'Escape'});assert.equal(view.queryByRole('dialog'),null);
  view.rerender(<Harness id="two"/>);await waitFor(()=>assert.equal(view.queryByRole('status'),null));
 }finally{cleanup();require.extensions['.css']=old;dom.window.close();}
});
