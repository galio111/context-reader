import test from "node:test";
import assert from "node:assert/strict";
import { finishExtensionLookup } from "../chrome-extension/src/lookupResult";
import { explanationAsStreamText } from "../lib/explanationDisplay";
import { DeepSeekParseError, explainWordWithDeepSeek } from "../lib/deepseek";
import { answerSentenceQuestionWithDeepSeek, sentenceQuestionFailure } from "../lib/sentenceQuestion";
import { ClientRequestCancelledError } from "../lib/requestCancellation";
import { fetchWithProviderFailover, resetProviderCircuitForTests } from "../lib/providerFailover";
import { providerDeclinedContent, TRANSLATION_CONTENT_RESTRICTION } from "../lib/providerContentRestriction";
import { requestArticleTranslation } from "../lib/articleTranslationTransport";
import type { WordExplanation } from "../types/reader";

const context = { word: "harbor", sentence: "We reached the harbor.", previousSentence: "", nextSentence: "" };
const explanation: WordExplanation = { word: "harbor", lemma: "harbor", phonetic: "/ˈhɑrbər/", phoneticFor: "harbor", partOfSpeech: "名词",
  basicMeaning: "港口", contextMeaning: "此处指避风港", sentenceTranslation: "我们到达了港口。", usageNote: "用于船舶停泊", collocation: "safe harbor（避风港）",
  exampleEnglish: "Ships enter the harbor.", exampleChinese: "船驶入港口。", difficulty: "easy", shouldAddToVocabulary: true,
  anki: { cardMode: "basic_cn_to_en", canMakeCloze: false, clozeSentence: "", contextCue: "", basicCue: "", frontPreview: "", backPreview: "" } };

test("two results settle independently, keeping closed fields and replacing a chopped final example", () => {
  const complete = explanationAsStreamText({...explanation,basicMeaning:"港湾"});
  const partial = complete.slice(0,complete.indexOf("船驶入")+1);
  assert.equal(finishExtensionLookup(context,null,partial,false),null);
  const recovered = finishExtensionLookup(context,explanation,partial,false)!;
  assert.equal(recovered.explanation.basicMeaning,"港湾"); assert.equal(recovered.explanation.exampleChinese,"船驶入港口。");
  assert.equal(finishExtensionLookup(context,null,complete,true)?.streamText,complete);
  assert.equal(finishExtensionLookup(context,{},complete,true)?.streamText,complete);
  const withoutIpa=explanationAsStreamText({...explanation,phonetic:"",phoneticFor:""});
  assert.equal(finishExtensionLookup(context,null,withoutIpa,true)?.explanation.phonetic,"");
  assert.equal(finishExtensionLookup(context,explanation,withoutIpa,true)?.streamText,explanationAsStreamText(explanation));
  assert.equal(finishExtensionLookup(context,explanation,complete,true)?.streamText,complete);
  assert.equal(finishExtensionLookup(context,{word:"different"},partial,false),null);
});

test("repair missing IPA once, discard mismatched pronunciation, and continue to require real learning content", async t => {
  const original = globalThis.fetch, env = {...process.env};
  t.after(()=>{globalThis.fetch=original;process.env=env;resetProviderCircuitForTests();});
  process.env.DEEPSEEK_API_KEY="fixture"; delete process.env.ZHIPU_API_KEY;
  for (const ipa of [{phonetic:"",phoneticFor:""}, {phonetic:"/other/",phoneticFor:"other"}]) {
    let calls=0;
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({...explanation,...ipa})}}]});};
    const result=await explainWordWithDeepSeek(context);
    assert.equal(calls,2); assert.equal(result.explanation.phonetic,""); assert.equal(result.explanation.phoneticFor,"");
    assert.equal(result.explanation.exampleChinese,explanation.exampleChinese);
  }
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({...explanation,contextMeaning:""})}}]});
  await assert.rejects(explainWordWithDeepSeek(context),DeepSeekParseError);
});

test("real transport, timeout, cancellation and malformed question replies keep distinct outcomes", async t => {
  const original=globalThis.fetch, env={...process.env}; t.after(()=>{globalThis.fetch=original;process.env=env;resetProviderCircuitForTests();});
  process.env.DEEPSEEK_API_KEY="fixture"; delete process.env.ZHIPU_API_KEY;
  const input={...context,question:"这里指什么？"};
  for(const [fetcher,code] of [
    [()=>Promise.reject(new TypeError("connection reset")),"provider_connection_failed"],
    [()=>Promise.reject(new DOMException("deadline","TimeoutError")),"provider_timeout"],
    [()=>Promise.resolve(new Response("invalid json")),"provider_parse_error"],
    [()=>Promise.resolve(Response.json({choices:[{message:{content:""}}]})),"provider_empty_content"],
  ] as const){
    globalThis.fetch=fetcher;
    await assert.rejects(answerSentenceQuestionWithDeepSeek(input),e=>sentenceQuestionFailure(e).code===code);
  }
  await assert.rejects(answerSentenceQuestionWithDeepSeek(input,[],AbortSignal.abort()),ClientRequestCancelledError);
});

test("translation refusals stop at the provider across HTTP, JSON and SSE and keep earlier blocks", async t => {
  const original=globalThis.fetch, env={...process.env}; t.after(()=>{globalThis.fetch=original;process.env=env;resetProviderCircuitForTests();});
  process.env.DEEPSEEK_API_KEY="fixture";process.env.ZHIPU_API_KEY="fixture-backup";
  const restricted={choices:[{finish_reason:"content_filter",delta:{},message:{content:""}}]};
  assert.ok(providerDeclinedContent({error:{message:"输入或生成内容可能包含不安全或敏感内容。"}}));
  for(const stream of [true,false]) {
    let calls=0; globalThis.fetch=async()=>{calls++;return stream? new Response("data: "+JSON.stringify(restricted)+"\n\n"):Response.json(restricted);};
    const result=await fetchWithProviderFailover("",{method:"POST",body:JSON.stringify({stream,messages:[]})},"translation");
    assert.equal(result.status,422);assert.equal(calls,1);assert.ok(providerDeclinedContent(await result.json()));
  }
  const blocks=[{id:"a",type:"paragraph" as const,text:"First."},{id:"b",type:"paragraph" as const,text:"Second."}];
  let requests=0;const received:string[]=[];
  globalThis.fetch=async()=>{requests++;return new Response([JSON.stringify({type:"translation",translation:{id:"a",translation:"第一句。"}}),
    JSON.stringify({type:"error",...TRANSLATION_CONTENT_RESTRICTION})].join("\n")+"\n");};
  await assert.rejects(requestArticleTranslation(blocks,new AbortController().signal,blocks,"test",()=>assert.fail("must not retry"),v=>received.push(v.id)),/内容限制/);
  assert.equal(requests,1);assert.deepEqual(received,["a"]);
});
