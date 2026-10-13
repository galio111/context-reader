import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";

test("different readings exclusively own playback, including late requests, decoding and changed words", async () => {
  const dom = new JSDOM("", {url:"https://context-reader.com"});
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true}))
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const pending = new Map<string,(value:Response)=>void>();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (_url,init) => new Promise<Response>(resolve => {
    const body=JSON.parse(String(init?.body)); pending.set(`${body.text}:${body.phonetic}`,resolve);
  });
  let playing=0, maxPlaying=0, created=0, stopped=0, decoded=0;
  const decodeQueue:Array<()=>void>=[];
  let delayDecode=false;
  class Context {
    destination={};
    state="running";
    get currentTime(){return performance.now()/1000;}
    addEventListener() {}
    removeEventListener() {}
    async resume() {}
    async decodeAudioData() {decoded++;if(delayDecode)await new Promise<void>(resolve=>decodeQueue.push(resolve));return {};}
    createBufferSource() {
      created++;let started=false;
      return {buffer:null,onended:null,connect(){},disconnect(){},
        start(){started=true;playing++;maxPlaying=Math.max(maxPlaying,playing);},
        stop(){if(started){playing--;stopped++;started=false;}}};
    }
  }
  Object.defineProperty(dom.window,"AudioContext",{value:Context,configurable:true});
  class NativeAudio {
    preload="";onended=null;onerror=null;onpause=null;ended=false;paused=true;
    async play(){this.paused=false;playing++;maxPlaying=Math.max(maxPlaying,playing);}
    pause(){if(!this.paused){playing--;this.paused=true;}}
    removeAttribute(){} load(){}
  }
  Object.defineProperty(globalThis,"Audio",{value:NativeAudio,configurable:true});
  const {PronunciationButtons}=await import("../components/PronunciationButtons");
  const {render,cleanup,waitFor,act}=await import("@testing-library/react");
  const {default:userEvent}=await import("@testing-library/user-event");
  const user=userEvent.setup({document:dom.window.document});
  const Pair=({word="bass"})=><><PronunciationButtons text={word} displayText="music" accents={["en-US"]} phonetics={{"en-US":"/beɪs/"}} allowBrowserFallback={false}/><PronunciationButtons text={word} displayText="fish" accents={["en-US"]} phonetics={{"en-US":"/bæs/"}} allowBrowserFallback={false}/></>;
  const finish=async(key:string)=>act(async()=>{assert.ok(pending.has(key));pending.get(key)!(new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}}));});
  try {
    const ui=render(<Pair/>);
    const music=ui.getByRole("button",{name:"播放 music 的美式发音"});
    const fish=ui.getByRole("button",{name:"播放 fish 的美式发音"});
    await user.click(music);await user.click(fish);
    assert.equal(fish.textContent,"▶美音","pending playback keeps its stable label and icon");
    assert.equal(ui.container.querySelector(".cr-loading-spinner"),null);
    await user.click(fish);
    assert.equal(fish.getAttribute("aria-busy"),"true","repeated clicks preserve pending intent");
    assert.equal(music.getAttribute("aria-busy"),"false");
    await finish("bass:/bæs/");await waitFor(()=>assert.equal(playing,1));
    await finish("bass:/beɪs/");assert.equal(created,1,"late first request must not start");
    await user.click(music);await waitFor(()=>assert.equal(created,2));
    assert.equal(stopped,1);assert.equal(fish.getAttribute("aria-pressed"),"false");
    assert.equal(playing,1);assert.equal(maxPlaying,1);
    ui.rerender(<Pair word="newword"/>);assert.equal(playing,0);
    await user.click(music);ui.rerender(<Pair word="nextword"/>);
    await finish("newword:/beɪs/");assert.equal(created,2,"old word request must not resume");
    delayDecode=true;
    await user.click(music);await finish("nextword:/beɪs/");await waitFor(()=>assert.equal(decodeQueue.length,1));
    await user.click(fish);await finish("nextword:/bæs/");await waitFor(()=>assert.equal(decodeQueue.length,2));
    await act(async()=>{decodeQueue[0]();decodeQueue[1]();});
    await waitFor(()=>assert.equal(playing,1));assert.equal(created,3);assert.equal(maxPlaying,1);
    cleanup();assert.equal(playing,0);
    delayDecode=false;
    const beforeDecode=decoded;
    const prepared=render(<PronunciationButtons text="prepared" preload accents={["en-US"]} allowBrowserFallback={false}/>);
    await finish("prepared:undefined");
    await waitFor(()=>assert.equal(decoded,beforeDecode+1));
    assert.equal(playing,0,"background fetch and decode must never autoplay");
    pending.delete("prepared:undefined");
    const button=prepared.getByRole("button",{name:"播放 prepared 的美式发音"});
    await user.click(button);await waitFor(()=>assert.equal(playing,1));
    assert.equal(decoded,beforeDecode+1,"first native click does not repeat background decoding");
    assert.equal(pending.has("prepared:undefined"),false,"first click makes no new request");
    await user.click(button);assert.equal(playing,0);
    await user.click(button);await waitFor(()=>assert.equal(playing,1));
    assert.equal(decoded,beforeDecode+1,"native replay does not repeat background decoding");
    cleanup();assert.equal(playing,0);
  } finally {cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
