import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import {JSDOM} from "jsdom";

test("different readings own one channel; late requests, rapid clicks, changes and preload preserve intent",async()=>{
  const dom=new JSDOM("",{url:"https://context-reader.com",pretendToBeVisual:true});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true}))
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const originalFetch=globalThis.fetch, originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
  const pending=new Map<string,(response:Response)=>void>(), blobs=new Map<string,Blob>();
  let serial=0,playing=0,maxPlaying=0,wordStarts=0;
  URL.createObjectURL=blob=>{const url="blob:test-"+(++serial);assert.ok(blob instanceof Blob);blobs.set(url,blob);return url;};
  URL.revokeObjectURL=url=>{blobs.delete(url);};
  globalThis.fetch=async(_url,init)=>new Promise(resolve=>{const body=JSON.parse(String(init?.body));pending.set(body.text+":"+body.phonetic,resolve);});
  class NativeAudio {
    src="";preload="";loop=false;onended=null;onerror=null;onpause=null;ended=false;paused=true;
    async play(){if(this.paused){playing++;maxPlaying=Math.max(maxPlaying,playing);}this.paused=false;if(blobs.get(this.src)?.type==="audio/mpeg")wordStarts++;}
    pause(){if(!this.paused){playing--;this.paused=true;}}
    removeAttribute(){this.src="";}load(){}
  }
  Object.defineProperty(globalThis,"Audio",{value:NativeAudio,configurable:true});
  const {PronunciationButtons}=await import("../components/PronunciationButtons");
  const {render,cleanup,waitFor,act}=await import("@testing-library/react");
  const {default:userEvent}=await import("@testing-library/user-event");
  const user=userEvent.setup({document:dom.window.document});
  const Pair=({word="bass"})=><><PronunciationButtons text={word} displayText="music" accents={["en-US"]} phonetics={{"en-US":"/beɪs/"}} allowBrowserFallback={false}/><PronunciationButtons text={word} displayText="fish" accents={["en-US"]} phonetics={{"en-US":"/bæs/"}} allowBrowserFallback={false}/></>;
  const finish=async(key:string)=>act(async()=>{assert.ok(pending.has(key));pending.get(key)!(new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}}));});
  try {
    const ui=render(<Pair/>),music=ui.getByRole("button",{name:"播放 music 的美式发音"}),fish=ui.getByRole("button",{name:"播放 fish 的美式发音"});
    await user.click(music);await user.click(fish);
    assert.equal(fish.textContent,"▶美音");assert.equal(ui.container.querySelector(".cr-loading-spinner"),null);
    await user.click(fish);assert.equal(fish.getAttribute("aria-busy"),"true");
    assert.equal(music.getAttribute("aria-busy"),"false");assert.equal(wordStarts,0);
    await finish("bass:/bæs/");await waitFor(()=>assert.equal(wordStarts,1));
    await finish("bass:/beɪs/");assert.equal(wordStarts,1,"late first request cannot sound");
    await user.click(music);await waitFor(()=>assert.equal(wordStarts,2));
    assert.equal(fish.getAttribute("aria-pressed"),"false");assert.equal(playing,1);assert.equal(maxPlaying,1);
    ui.rerender(<Pair word="newword"/>);assert.equal(playing,0);
    await user.click(music);ui.rerender(<Pair word="nextword"/>);
    await finish("newword:/beɪs/");assert.equal(wordStarts,2,"old word cannot resume");
    await user.click(music);await user.click(fish);
    await finish("nextword:/beɪs/");assert.equal(wordStarts,2);
    await finish("nextword:/bæs/");await waitFor(()=>assert.equal(wordStarts,3));assert.equal(maxPlaying,1);
    cleanup();assert.equal(playing,0);
    const prepared=render(<PronunciationButtons text="prepared" preload accents={["en-US"]} allowBrowserFallback={false}/>);
    await finish("prepared:undefined");assert.equal(playing,0,"preload never starts a player");
    pending.delete("prepared:undefined");
    const button=prepared.getByRole("button",{name:"播放 prepared 的美式发音"});
    await user.click(button);await waitFor(()=>assert.equal(wordStarts,4));
    assert.equal(pending.has("prepared:undefined"),false,"warm first click adds no request");
    await user.click(button);assert.equal(playing,0);
    await user.click(button);await waitFor(()=>assert.equal(wordStarts,5));assert.equal(maxPlaying,1);
    cleanup();assert.equal(playing,0);assert.equal(blobs.size,0);
  }finally{cleanup();globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.close();}
});
