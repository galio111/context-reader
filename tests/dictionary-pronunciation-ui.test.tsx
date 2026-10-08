import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
import { groupDictionaryPronunciations, dictionaryPronunciationRows, phoneticComparisonKey } from "../lib/dictionaryPronunciation";
import { requiresCurrentFormPhonetic } from "../lib/pronunciation";
import type { DictionaryResult } from "../types/dictionary";

test("ordinary words use the reader playback path; only distinct readings within an accent send IPA", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com" });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let spoken = 0;
  Object.defineProperty(dom.window, "speechSynthesis", { value: { cancel() {}, speak() { spoken++; }, getVoices() { return []; } } });
  Object.defineProperty(dom.window, "SpeechSynthesisUtterance", { value: class {} });
  const calls: Array<{ text: string; accent: string; phonetic: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ code: "provider_tts_failed" }, { status: 502 });
  };
  const { PronunciationButtons } = await import("../components/PronunciationButtons");
  const { render, cleanup, waitFor } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  // Execute the production rendering function, with its real playback controls.
  const source = readFileSync(new URL("../components/BookDictionary.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function DictionaryPronunciations(");
  const end = source.indexOf("\nfunction readSession", start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const Component = runInNewContext(js + "\nDictionaryPronunciations", { React, PronunciationButtons, groupDictionaryPronunciations, dictionaryPronunciationRows, phoneticComparisonKey, requiresCurrentFormPhonetic, styles: {}, partOfSpeechLabels: { noun: "名词", verb: "动词" } }) as React.ComponentType<{result: DictionaryResult}>;
  try {
    const pronunciations = [
      { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈredʒɪment/" },
      { accent: "en-GB", partOfSpeech: "noun", phonetic: "/ˈredʒɪment/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "/ˈredʒɪment/" },
      { accent: "en-GB", partOfSpeech: "verb", phonetic: "/ˈredʒɪment/" },
    ] as DictionaryResult["pronunciations"];
    const ui = render(<Component result={{ query: "regiment", pronunciations } as DictionaryResult} />);
    assert.equal(ui.container.querySelectorAll("strong").length, 0);
    assert.equal(ui.container.querySelectorAll("button").length, 2);
    assert.doesNotMatch(ui.container.textContent ?? "", /英美共用|语境发音|the regiment|to regiment/);
    const user = userEvent.setup({ document: dom.window.document });
    await waitFor(() => assert.equal(calls.length, 2));
    assert.deepEqual(calls.slice(0, 2), [{text:"regiment",accent:"en-US"}, {text:"regiment",accent:"en-GB"}]);
    await user.click(ui.getByRole("button", { name: "播放 regiment 的美式发音" }));
    await waitFor(() => assert.equal(calls.length, 3));
    await waitFor(() => assert.ok(ui.getByText("云端美音暂时不可用，请稍后重试。")));
    assert.deepEqual(calls[2], { text: "regiment", accent: "en-US" });
    assert.equal(spoken, 0);
    ui.rerender(<Component result={{ query: "record", pronunciations: [
      { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈrekərd/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "/rɪˈkɔːrd/" },
    ] } as DictionaryResult} />);
    await waitFor(() => assert.equal(calls.length, 5));
    assert.deepEqual(Array.from(ui.container.querySelectorAll("strong"), el => el.textContent), ["名词", "动词"]);
    await user.click(ui.getAllByRole("button", { name: "播放 record 的美式发音" })[1]);
    await waitFor(() => assert.equal(calls.length, 6));
    assert.deepEqual(calls[5], { text: "record", accent: "en-US", phonetic: "/rɪˈkɔːrd/" });
    // Different US/UK IPA alone is not a heteronym. Neither new results nor
    // restored history should force ordinary words through phoneme synthesis.
    for (const [word, us, uk] of [
      ["bibliography", "/ˌbɪbliˈɑɡrəfi/", "/ˌbɪbliˈɒɡrəfi/"],
      ["humiliate", "/hjuːˈmɪlieɪt/", "/hjuːˈmɪlieɪt/"],
      ["lever", "/ˈlevər/", "/ˈliːvə/"],
      ["peg", "/peɡ/", "/peɡ/"],
    ]) {
      const before = calls.length;
      ui.rerender(<Component result={{query:word, pronunciations:[
        {accent:"en-US", partOfSpeech:"noun", phonetic:us},
        {accent:"en-US", partOfSpeech:"verb", phonetic:us},
        {accent:"en-GB", partOfSpeech:"noun", phonetic:uk},
        {accent:"en-GB", partOfSpeech:"verb", phonetic:uk},
      ]} as DictionaryResult}/>);
      await waitFor(() => assert.equal(calls.length, before + 2));
      assert.deepEqual(calls.slice(before), [{text:word,accent:"en-US"},{text:word,accent:"en-GB"}]);
      assert.equal(ui.container.querySelectorAll("strong").length, 0);
    }
    const before = calls.length;
    ui.rerender(<Component result={{query:"alternate", pronunciations:[
      {accent:"en-US",partOfSpeech:"noun",phonetic:"/ˈɑːltɝːnət/"},
      {accent:"en-US",partOfSpeech:"adjective",phonetic:"/ˈɑːltɝːnət/"},
      {accent:"en-GB",partOfSpeech:"noun",phonetic:"/ˈɒltənət/"},
      {accent:"en-GB",partOfSpeech:"adjective",phonetic:"/ɒlˈtɜːnət/"},
    ]} as DictionaryResult}/>);
    await waitFor(() => assert.equal(calls.length, before + 3));
    assert.ok(calls.slice(before).filter(call=>call.accent==="en-US").every(call=>!("phonetic" in call)));
    assert.deepEqual(calls.slice(before).filter(call=>call.accent==="en-GB").map(call=>call.phonetic), ["/ˈɒltənət/", "/ɒlˈtɜːnət/"]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});

test("repeated clicks while audio is loading keep the original request and playback intent", async () => {
  const dom=new JSDOM("",{url:"https://context-reader.com"});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const originalFetch=globalThis.fetch;let finish!:(value:Response)=>void;let calls=0;
  globalThis.fetch=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const {PronunciationButtons}=await import("../components/PronunciationButtons");
  const {render,cleanup,waitFor}=await import("@testing-library/react");
  const {default:userEvent}=await import("@testing-library/user-event");
  try{
    const ui=render(<PronunciationButtons text="pendingcase" accents={["en-US"]} allowBrowserFallback={false}/>);
    const user=userEvent.setup({document:dom.window.document}),button=ui.getByRole("button");
    await user.click(button);await waitFor(()=>assert.equal(button.getAttribute("aria-busy"),"true"));
    await user.click(button);assert.equal(button.getAttribute("aria-busy"),"true");assert.equal(calls,1);
    finish(Response.json({code:"provider_tts_failed"},{status:502}));
    await waitFor(()=>assert.equal(button.getAttribute("aria-busy"),"false"));
  }finally{cleanup();globalThis.fetch=originalFetch;dom.window.close();}
});
