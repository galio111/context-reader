import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { usePublicationMountCount } from "../components/usePublicationMountCount";
import { useShowcaseCoversReady } from "../components/useShowcaseCoversReady";

test("full catalogue mounts in bounded commits and restores distant Reader origins without losing search results", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const idle = new Map<number,()=>void>(); let next = 0;
  const win = dom.window as unknown as Window & typeof globalThis;
  win.requestIdleCallback = callback => {const id=++next;idle.set(id,()=>callback({didTimeout:false,timeRemaining:()=>5}));return id;};
  win.cancelIdleCallback = id => {idle.delete(id);};
  for (const [key,value] of Object.entries({window:win,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const counts:number[] = [];
  function List({query="",total=500,origin=0}:{query?:string;total?:number;origin?:number}){
    const count = usePublicationMountCount(query,total,origin);counts.push(count);
    return <div data-count={count}/>;
  }
  const root=createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async()=>root.render(<List/>));assert.equal(counts.at(-1),36);
    for(let i=0;i<20&&idle.size;i++)await act(async()=>{const batch=[...idle.values()];idle.clear();batch.forEach(run=>run());});
    assert.equal(counts.at(-1),500);
    assert.ok(counts.every((n,i)=>i===0||n-counts[i-1]<=36),"each commit stays bounded");
    await act(async()=>root.render(<List query="tail article" total={1}/>));assert.equal(counts.at(-1),1,"search considers the full catalogue");
    await act(async()=>root.render(<List query="restored" origin={461}/>));assert.equal(counts.at(-1),461,"the target exists before Reader scroll restoration");
    await act(async()=>root.unmount());assert.equal(idle.size,0);
  }finally{dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test("speculative media waits for actual showcase completion without waiting for distant covers", async () => {
  const dom = new JSDOM('<div id="root"></div><img data-cover-eager><img id="distant">');
  const saved=new Map(["window","document","IS_REACT_ACT_ENVIRONMENT"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const img=dom.window.document.querySelector("img")!;let complete=false;Object.defineProperty(img,"complete",{get:()=>complete});
  const states:boolean[]=[];function Probe(){states.push(useShowcaseCoversReady());return null;}
  const root=createRoot(dom.window.document.getElementById("root")!);
  try{
    await act(async()=>root.render(<Probe/>));assert.equal(states.at(-1),false);
    await act(async()=>dom.window.document.getElementById("distant")!.dispatchEvent(new dom.window.Event("load")));assert.equal(states.at(-1),false);
    complete=true;await act(async()=>img.dispatchEvent(new dom.window.Event("load")));assert.equal(states.at(-1),true);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
