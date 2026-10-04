import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as React from "react";
import {JSDOM} from "jsdom";
import {IDBFactory} from "fake-indexeddb";
import * as learning from "../lib/learningStorage";
import * as history from "../lib/standaloneDictionaryHistory";
import * as cache from "../lib/standaloneDictionaryCache";
import * as snapshots from "../lib/dictionaryResultSnapshot";
import * as events from "../lib/accountEvents";
import * as stream from "../lib/dictionaryStream";
import * as spelling from "../lib/dictionarySpelling";
import * as pronunciation from "../lib/dictionaryPronunciation";
import {requiresCurrentFormPhonetic} from "../lib/pronunciation";

test("a completed new lookup replays after remount with no model/quota request; partial and missing histories cannot auto-generate",async()=>{
  const dom=new JSDOM("",{url:"https://context-reader.com"});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,CustomEvent:dom.window.CustomEvent,StorageEvent:dom.window.StorageEvent,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  Object.defineProperty(dom.window,"indexedDB",{value:new IDBFactory()});
  const source=readFileSync(new URL("../components/BookDictionary.tsx",import.meta.url),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const modules:Record<string,unknown>={"react":React,
    "@/lib/accountUsageNavigation":{openAccountUsage(){},isQuotaMessage(){return false;}},
    "@/components/PronunciationButtons":{PronunciationButtons:()=>null},
    "@/components/AccountProvider":{useAccount:()=>({loading:false,account:{profile:null},localAccount:null})},
    "@/components/ClearableField":{default:({children}:{children:React.ReactNode})=><div>{children}</div>},
    "@/lib/learningStorage":learning,"@/lib/accountEvents":events,"@/lib/dictionaryStream":stream,
    "@/lib/dictionarySpelling":spelling,"@/lib/standaloneDictionaryCache":cache,
    "@/lib/dictionaryResultSnapshot":snapshots,"@/lib/standaloneDictionaryHistory":history,
    "@/lib/dictionaryPronunciation":pronunciation,"@/lib/pronunciation":{requiresCurrentFormPhonetic},
    "@/lib/lookupCancellationClient":{notifyLookupCancellation(){}},
    "@/lib/clientErrorReporting":{validateStandaloneDictionaryInput(){return "";},describeCaughtRequestError:()=>"",describeApiFailure:()=>""},
    "./BookDictionary.module.css":{default:{}},
  };
  const context={exports:{},React,require:(key:string)=>{if(!(key in modules))throw Error(key);return modules[key];},
    window:dom.window,StorageEvent:dom.window.StorageEvent,AbortController,TextDecoder,crypto,
    ResizeObserver:class{observe(){}disconnect(){}},console,fetch:(...args:Parameters<typeof fetch>)=>globalThis.fetch(...args)};
  const Component=runInNewContext(output+"\nexports.BookDictionary",context) as React.ComponentType;
  const originalFetch=globalThis.fetch,calls:string[]=[];
  let complete=true;
  globalThis.fetch=async(input,init)=>{
    calls.push(String(input));
    if(String(input).includes("dictionary-history"))return Response.json({dictionary:null},{status:404});
    assert.equal(init?.method,"POST");
    const query=JSON.parse(String(init?.body)).query;
    return new Response([
      JSON.stringify({type:"head",query,lemma:query,direction:"en_to_cn",inputStatus:"valid"}),
      JSON.stringify({type:"sense",partOfSpeech:"noun",meaning:"完整释义",exampleEnglish:"The full example.",exampleChinese:"完整例句"}),
      ...(complete?[JSON.stringify({type:"done"})]:[]),
    ].join("\n")+"\n");
  };
  const {render,cleanup,waitFor,act}=await import("@testing-library/react");
  const {default:userEvent}=await import("@testing-library/user-event");
  try{
    await learning.initializeLearningStorage();const user=userEvent.setup({document:dom.window.document});
    let ui=render(<Component/>);
    await waitFor(()=>assert.ok(ui.getByRole("combobox")));
    await user.type(ui.getByRole("combobox"),"retention");
    await user.click(ui.getByRole("button",{name:"深度查询"}));
    await waitFor(()=>assert.ok(ui.getByRole("button",{name:"retention"})));
    await learning.flushLearningStorage();
    assert.equal(calls.length,1);
    ui.unmount();window.sessionStorage.clear();
    ui=render(<Component/>);
    await waitFor(()=>assert.ok(ui.getByRole("button",{name:"retention"})));
    await user.click(ui.getByRole("button",{name:"retention"}));
    await waitFor(()=>assert.ok(ui.getByText("完整例句")));
    assert.equal(calls.length,1,"historical replay must not hit the generation API");
    complete=false;await user.clear(ui.getByRole("combobox"));await user.type(ui.getByRole("combobox"),"partial");
    await user.click(ui.getByRole("button",{name:"深度查询"}));
    await waitFor(()=>assert.ok(ui.getByText("词典结果没有完整生成，请重新查询。")));
    assert.ok(!history.readStandaloneDictionaryHistory().some(item=>item.query==="partial"));
    await act(async()=>{history.recordStandaloneDictionaryHistory("oldmissing");});
    await waitFor(()=>assert.ok(ui.getByRole("button",{name:"oldmissing"})));
    await user.click(ui.getByRole("button",{name:"oldmissing"}));
    await waitFor(()=>assert.ok(ui.getByText(/这条旧历史未保存完整结果/)));
    assert.equal(calls.length,2,"missing guest history also must not trigger generation");
  }finally{
    cleanup();globalThis.fetch=originalFetch;await learning.flushLearningStorage();
    const storage=learning.getLearningStorage();if(learning.isLearningStorage(storage))storage.close();dom.window.close();
  }
});
