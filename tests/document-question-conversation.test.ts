import test from "node:test";
import assert from "node:assert/strict";
import { answerSentenceQuestionWithDeepSeek } from "../lib/sentenceQuestion";

test("latest follow-up is the final user turn, with reference data and prior answers in distinct messages",async()=>{
  const previousFetch=globalThis.fetch;
  const previousKey=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY="test-only";
  let messages:{role:string;content:string}[]=[];
  globalThis.fetch=async (_url,init)=>{
    messages=JSON.parse(String(init?.body)).messages;
    return Response.json({choices:[{message:{content:"New mechanism answer\\n\\nPaper evidence"}}]});
  };
  try{
    const result=await answerSentenceQuestionWithDeepSeek({word:"acid",sentence:"",previousSentence:"",nextSentence:"",question:"Why does it strengthen the gel?",document:{title:"Paper",blocks:[]},history:[...Array.from({length:10},(_,i)=>({question:`Earlier question ${i}`,answer:`Earlier answer ${i}`})),{question:"What is it?",answer:"Prior definition"}]},[{title:"Source",url:"https://example.org",text:"Reference facts"}]);
    assert.ok(messages[0].content.includes("不输出参考文献、来源列表、链接或 [1] 这类引用编号"));
    assert.ok(!messages[0].content.includes("引用时使用给定编号 [1]"));
    assert.equal(messages.at(-1)?.role,"user");
    assert.equal(JSON.parse(messages.at(-1)!.content).question,"Why does it strengthen the gel?");
    assert.equal(messages.at(-2)?.role,"assistant");
    assert.equal(messages.at(-2)?.content,"Prior definition");
    assert.ok(messages.some(m=>m.content.includes('"externalSources"')));
    assert.ok(messages.some(m=>m.content==="Earlier answer 0"));
    assert.equal(result.answer,"New mechanism answer\n\nPaper evidence");
  }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;}
});
