import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { pronunciationGestureSilence } from "../lib/pronunciationPlayback";
import { requestPronunciationMedia } from "../lib/pronunciationClient";

test("older Safari fetch works without AbortSignal.timeout and classifies interrupted bodies", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout"), original = globalThis.fetch;
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => { calls++; assert.ok(init?.signal instanceof AbortSignal); return new Response(new Uint8Array([1,2,3])); };
    const [a,b] = await Promise.all([requestPronunciationMedia("old-safari","en-US"),requestPronunciationMedia("old-safari","en-US")]);
    assert.equal(calls,1); assert.equal(a,b);
    globalThis.fetch = async () => ({ok:true,arrayBuffer:async()=>{throw new DOMException("aborted","AbortError");}}) as unknown as Response;
    await assert.rejects(requestPronunciationMedia("interrupted-body","en-US"),{code:"pronunciation_network"});
  } finally { globalThis.fetch=original; if(descriptor)Object.defineProperty(AbortSignal,"timeout",descriptor); }
});

test("gesture primer is a valid PCM WAV with only zero samples", async () => {
  const blob=pronunciationGestureSilence(), bytes=new Uint8Array(await blob.arrayBuffer()), view=new DataView(bytes.buffer);
  assert.equal(blob.type,"audio/wav"); assert.equal(new TextDecoder().decode(bytes.slice(0,4)),"RIFF");
  assert.equal(view.getUint32(4,true),bytes.length-8); assert.equal(view.getUint32(24,true),8000);
  assert.equal(view.getUint32(40,true),bytes.length-44); assert.ok(bytes.slice(44).every(value=>value===0));
});

test("every cold word plays after one click without Web Audio; stale loads and genuine denial stay safe", async () => {
  const dom=new JSDOM("",{url:"https://context-reader.com",pretendToBeVisual:true});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true}))
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const originalFetch=globalThis.fetch, originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
  const blobs=new Map<string,Blob>(), pending=new Map<string,(response:Response)=>void>();
  let serial=0,inClick=false,deny=false,requests=0;
  URL.createObjectURL=blob=>{const url="blob:test-"+(++serial);blobs.set(url,blob);return url;};
  URL.revokeObjectURL=url=>{blobs.delete(url);};
  globalThis.fetch=async(_url,init)=>{requests++;const text=JSON.parse(String(init?.body)).text;return new Promise(resolve=>pending.set(text,resolve));};
  Object.defineProperty(dom.window,"AudioContext",{value:undefined,configurable:true});
  const players: NativeAudio[]=[], words: NativeAudio[]=[];
  class NativeAudio {
    src="";preload="";loop=false;muted=false;ended=false;paused=true;authorized=false;
    onended:(()=>void)|null=null;onpause:(()=>void)|null=null;onerror:(()=>void)|null=null;
    constructor(){players.push(this);}
    play(){
      if(deny||(!inClick&&!this.authorized))return Promise.reject(new DOMException("gesture required","NotAllowedError"));
      assert.equal(this.muted,false,"muting does not authorize a later audible source");
      this.authorized=true;this.paused=false;
      if(blobs.get(this.src)?.type==="audio/mpeg")words.push(this);
      return Promise.resolve();
    }
    pause(){if(!this.paused){this.paused=true;queueMicrotask(()=>this.onpause?.());}}
    removeAttribute(){this.src="";} load(){}
  }
  Object.defineProperty(globalThis,"Audio",{value:NativeAudio,configurable:true});
  const {PronunciationButtons}=await import("../components/PronunciationButtons");
  const {render,cleanup,waitFor,act,fireEvent}=await import("@testing-library/react");
  const ui=render(<PronunciationButtons text="first" allowBrowserFallback={false}/>);
  const button=()=>ui.getByRole("button",{name:/美式发音/});
  const click=()=>{inClick=true;fireEvent.click(button());inClick=false;};
  const word=(text:string)=>ui.rerender(<PronunciationButtons text={text} allowBrowserFallback={false}/>);
  const finish=async(text:string)=>act(async()=>pending.get(text)!(new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}})));
  try {
    for(const text of ["first","second","third"]){
      word(text);const before=words.length;click();const primer=players.at(-1)!;
      assert.ok(primer.authorized,"player starts synchronously before fetch returns");
      assert.equal(button().getAttribute("aria-pressed"),"false","silent preparation is not word playback");
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,60));});
      assert.equal(words.length,before);await finish(text);
      await waitFor(()=>assert.equal(button().getAttribute("aria-pressed"),"true"));
      assert.equal(words.length,before+1,"one click plays each new word");
      assert.equal(words.at(-1),primer,"reuse the exact authorized element");assert.equal(primer.loop,false);
      assert.equal(ui.queryByRole("status"),null,"queued primer pause is not interruption");
      click();assert.equal(primer.paused,true);
    }
    word("stale");click();word("replacement");const before=words.length;
    await finish("stale");assert.equal(words.length,before);
    word("hidden");click();fireEvent(window,new dom.window.Event("pagehide"));
    await finish("hidden");assert.equal(words.length,before,"pagehide cancels eventual playback");
    click();await waitFor(()=>assert.equal(words.length,before+1));await finish("hidden");
    word("denied");deny=true;click();await finish("denied");
    await waitFor(()=>assert.ok(ui.getByText("声音未能启动，请再点一次发音按钮。")));
    deny=false;const fetched=requests;click();
    await waitFor(()=>assert.equal(button().getAttribute("aria-pressed"),"true"));
    assert.equal(requests,fetched,"genuine rejection retry does not regenerate");
    cleanup();assert.ok(players.every(player=>player.paused));assert.equal(blobs.size,0);
  } finally {cleanup();globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.close();}
});
