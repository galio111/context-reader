import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyArticle } from '../lib/articleClassification';
test('full-text classification transmits middle paragraphs and refuses invalid category evidence', async () => {
 const oldKey=process.env.DEEPSEEK_API_KEY, oldFetch=globalThis.fetch;
 process.env.DEEPSEEK_API_KEY='local-test-placeholder';
 const first='The company receives subscription revenue from its customers.';
 const second='Its financing round supports hiring and international expansion.';
 const text=first+'\n'+('ordinary reading context '.repeat(1200))+'\nMIDDLE_SENTENCE_EVIDENCE\n'+second;
 let evidence:unknown={rationale:'企业融资与收入模式',quotes:[first,second]};
 let category='商业';
 globalThis.fetch=async(input, init)=>{assert.ok(String(input).startsWith('https://api.deepseek.com/'));const body=JSON.parse(String(init?.body));assert.ok(body.messages[0].content.includes(text));return Response.json({choices:[{message:{content:JSON.stringify({difficulty:'CET-6 / 考研',cefr:'C1',topics:['商业经济'],homepageCategory:category,categoryEvidence:evidence,summary:'这篇文章介绍企业如何依靠订阅收入扩展业务，以及融资带来的人员与市场扩张。',confidence:'high'})}}],usage:{prompt_tokens:100,completion_tokens:20}});};
 try {assert.equal((await classifyArticle('Business',text,{fullTextReview:true})).classificationSource,'model');evidence={rationale:'虚构证据',quotes:['This phrase is absent from the text.','Another invented quotation here.']};assert.equal((await classifyArticle('Business',text,{fullTextReview:true})).classificationSource,'heuristic');category='unknown';assert.equal((await classifyArticle('Business',text,{fullTextReview:true})).classificationSource,'heuristic');}
 finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;}
});
