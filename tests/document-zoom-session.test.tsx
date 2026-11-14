import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useRef,useState} from 'react';
import {JSDOM} from 'jsdom';
import {useDocumentZoomAnchor} from '../components/useDocumentZoomAnchor';

test('zoom retention applies delayed layout corrections and yields immediately to real wheel navigation',async()=>{
 const dom=new JSDOM('',{url:'https://context-reader.com',pretendToBeVisual:true});
 Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
 let observerCallback=()=>{};
 globalThis.ResizeObserver=class {constructor(callback:()=>void){observerCallback=callback;}observe(){}unobserve(){}disconnect(){}} as unknown as typeof ResizeObserver;
 const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
 let late=0;let host:HTMLElement;
 const rect=(top:number,height:number)=>({left:0,right:600,top,bottom:top+height,width:600,height} as DOMRect);
 function Harness(){const root=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null);const [scale,setScale]=useState(1);const capture=useDocumentZoomAnchor(root,scroll,'paper');return <div ref={node=>{if(node){host=node;node.style.overflowY='auto';Object.defineProperties(node,{scrollHeight:{value:5000,configurable:true},clientHeight:{value:800,configurable:true}});if(!node.scrollTop)node.scrollTop=1000;}}}><div ref={node=>{root.current=node;if(node)node.getBoundingClientRect=()=>rect(-100,5000);}}><button data-document-toolbar onClick={()=>{capture();setScale(v=>v+.5);}}>zoom</button><div ref={node=>{scroll.current=node;if(node)node.getBoundingClientRect=()=>rect(-100,5000);}}><section style={{height:1000*scale}} ref={node=>{if(node)node.getBoundingClientRect=()=>rect(1200*scale+late-host.scrollTop,1000*scale);}}><div data-document-page="3"/></section></div></div></div>;}
 try{
  const view=render(<Harness/>);const before=host!.scrollTop;fireEvent.click(view.getByText('zoom'));
  await waitFor(()=>assert.ok(host!.scrollTop>before));
  const retained=host!.scrollTop;late=80;observerCallback();await waitFor(()=>assert.ok(host!.scrollTop>=retained+79));
  fireEvent.wheel(dom.window);host!.scrollTop+=50;const manual=host!.scrollTop;late+=80;observerCallback();await new Promise(resolve=>setTimeout(resolve,40));assert.equal(host!.scrollTop,manual);
 }finally{cleanup();dom.window.close();}
});

