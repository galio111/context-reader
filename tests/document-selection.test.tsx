import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { documentSelectionMode, expandDocumentWordEdges, normalizeDocumentSelection } from "../lib/documentSelection";
import { selectionTranslationBlocks, useDocumentSelectionTranslation } from "../components/DocumentSelectionTranslation";
import { initializeLearningStorage, getLearningStorage } from "../lib/learningStorage";
import { setCachedArticleTranslationForBlocks } from "../lib/cache";
import type { ImportedArticle } from "../types/article";
import type { WordContext } from "../types/reader";

const text = "The original paper retains all figures and labels.";
const article = { document: { id: "a".repeat(64), format: "pdf", pageCount: 1, name: "paper.pdf" }, blocks: [{ id: "doc-p1-b0", type: "paragraph", text }] } as ImportedArticle;
const context = (word: string): WordContext => ({ word, sentence: text, previousSentence: "", nextSentence: "", paragraphIndex: 0, tokenIndex: 0 });

test("document selection expands word edges and applies the five-word boundary without invalid lexical requests", () => {
  assert.equal(documentSelectionMode("It led to markedly"), "lookup");
  assert.equal(documentSelectionMode("It led to markedly reduced"), "lookup");
  assert.equal(documentSelectionMode("It led to markedly reduced toxicity"), "translation");
  assert.equal(documentSelectionMode("It led to markedly reduced toxicity in normal tissues"), "translation");
  assert.equal(documentSelectionMode("Figure 3"), "translation");
  assert.equal(documentSelectionMode("… , [3]"), "ignore");
  const source = "targeting. It led to markedly reduced";
  const [start, end] = expandDocumentWordEdges(source, source.indexOf("It") + 1, source.indexOf("markedly") + 3);
  assert.equal(source.slice(start, end), "It led to markedly");
  const broken = "The antibac-\nterial treatment";
  const [left, right] = expandDocumentWordEdges(broken, broken.indexOf("terial") + 1, broken.indexOf("terial") + 3);
  assert.equal(normalizeDocumentSelection(broken.slice(left,right)), "antibacterial");
  assert.equal(normalizeDocumentSelection("colistin-\nassociated toxicity"), "colistin-associated toxicity");
});

test("only exact whole blocks reuse full-article translation identity and long selections are not truncated", () => {
  assert.deepEqual(selectionTranslationBlocks(text, article), article.blocks);
  assert.notEqual(selectionTranslationBlocks("The original paper retains all figures", article)[0].id, "doc-p1-b0");
  const large = "A long scientific sentence. ".repeat(2000);
  const blocks = selectionTranslationBlocks(large, article);
  assert.equal(blocks.map(b => b.text).join(""), large);
  assert.ok(blocks.every(b => b.text.length < 4100));
});

test("selected translation replays exact cache, cancels stale selection and hides previous owner results", async () => {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  const keys = ["window", "document", "navigator", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as unknown as Record<string,unknown>)[key]});
  Object.defineProperty(dom.window,"indexedDB",{value:new IDBFactory()});
  const { renderHook, act, cleanup } = await import("@testing-library/react");
  const oldFetch = globalThis.fetch;
  const requests: { signal: AbortSignal; block: {id:string}; resolve: (r:Response)=>void }[] = [];
  globalThis.fetch = async (_, options) => new Promise(resolve => requests.push({signal: options!.signal as AbortSignal, block: JSON.parse(String(options!.body)).blocks[0], resolve}));
  const finish = (index: number, translation: string) => requests[index].resolve(new Response(JSON.stringify({type:"translation",translation:{id:requests[index].block.id,translation}})+"\n"));
  try {
    await initializeLearningStorage(); getLearningStorage().setItem("context-reader:local-account-owner:v1","A");
    setCachedArticleTranslationForBlocks(selectionTranslationBlocks(text,article),[{id:"doc-p1-b0",translation:"已有整段译文"}]);
    const ui = renderHook(({selected,owner})=>useDocumentSelectionTranslation(selected,article,owner,false), {initialProps:{selected:context(text),owner:"A"}});
    assert.equal(ui.result.current.text,"已有整段译文"); assert.equal(requests.length,0);
    await act(async()=>ui.rerender({selected:context("The original paper retains all figures"),owner:"A"}));
    assert.equal(ui.result.current.text,""); assert.equal(requests.length,1);
    await act(async()=>ui.rerender({selected:context("The original paper retains all figures and"),owner:"A"}));
    assert.equal(requests[0].signal.aborted,true);
    await act(async()=>{finish(0,"不应出现的旧译文"); finish(1,"当前选区译文"); await new Promise(r=>setTimeout(r,10));});
    assert.equal(ui.result.current.text,"当前选区译文");
    await act(async()=>ui.rerender({selected:context("Another selection with more than five words"),owner:"B"}));
    assert.equal(ui.result.current.text,"");
    await act(async()=>{ requests.at(-1)!.resolve(Response.json({error:"请求缺少 word、sentence 或 word 格式不正确。"},{status:400})); await new Promise(r=>setTimeout(r,10)); });
    assert.equal(ui.result.current.notice,"暂时未能取得译文，稍后可以重试。");
    assert.equal(ui.result.current.text,"");
    await act(async()=>ui.result.current.retry()); ui.unmount();
    assert.equal(requests.at(-1)!.signal.aborted,true);
  } finally {
    cleanup(); globalThis.fetch=oldFetch; dom.window.close();
    for(const [key,descriptor] of saved) { if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key); }
  }
});
