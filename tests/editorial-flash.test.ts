import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFlashAudit,flashPrompt,cleanEditorialFurniture,auditEditorialFlash} from '../lib/editorialFlash';
import {withEditorialBudget,withEditorialArticle,editorialPaidRequest,markEditorialOutcome,getEditorialSpend,type EditorialSpend} from '../lib/editorialBudget';
import type {ImportedArticle} from '../types/article';
const prose='This paragraph explains the historical evidence and its implications for ordinary readers. '.repeat(40);
const article:ImportedArticle={title:'Evidence and history',url:'https://sciencealert.com/example',siteName:'Example',text:prose,blocks:[{id:'a',type:'paragraph',text:prose},{id:'b',type:'paragraph',text:'The final paragraph explains the limitations.'},{id:'c',type:'image',src:'https://example.com/photo.webp',alt:'Artifact'}]};
const output={category:2,topic:2,level:1,cefr:'B2',summary:'历史证据与解释',evidence:[0,1],rationale:'讨论历史文物，句法适合 B2',confidence:'high',timely:false,eligible:true,specialist:false,imagesRelevant:true,uncertain:false,checks:{incomplete:false,contamination:false,orphanCaption:false,mediaDependent:false,promotional:false},reason:'clean'};
test('block evidence validates without brittle verbatim quote copying; invalid indices fail closed',()=>{
 assert.equal(parseFlashAudit(article,output).review.status,'passed');
 for(const evidence of [[0,0],[0,99],[0,2],['0',1]])assert.throws(()=>parseFlashAudit(article,{...output,evidence}));
 assert.throws(()=>parseFlashAudit(article,{...output,checks:{incomplete:false}}));
 assert.throws(()=>parseFlashAudit(article,{...output,level:2,cefr:'B2'}));
});
test('uncertainty, image mismatch and content defects cannot auto-approve',()=>{
 for(const patch of [{uncertain:true},{imagesRelevant:false},{confidence:'low'},{checks:{...output.checks,orphanCaption:true}}])assert.equal(parseFlashAudit(article,{...output,...patch}).review.status,'held');
  assert.ok(flashPrompt(article).includes('The final paragraph explains the limitations.'));
  const missing={...article,blocks:[...article.blocks,{id:'missing',type:'caption' as const,text:'Figure 1. The figure has not been loaded.'}]};
  assert.equal(parseFlashAudit(missing,output).review.status,'held');
});
test('source rules remove subscription artwork, never real images, quoted mentions or another host',()=>{
 const noisy={...article,blocks:[...article.blocks,{id:'ad',type:'image' as const,src:'https://example.com/ad.webp',alt:"Subscribe to ScienceAlert's free fact-checked newsletter"},{id:'q',type:'quote' as const,text:'Advertisement'}]};
 const cleaned=cleanEditorialFurniture(noisy);
 assert.equal(cleaned.blocks.filter(b=>b.type==='image').length,1);
 assert.ok(cleaned.blocks.some(b=>b.type==='quote'));
 assert.equal(cleanEditorialFurniture({...noisy,url:'https://another.org/article'}).blocks.length,noisy.blocks.length);
});
test('one integrated Flash call, no Pro or retries for held or malformed output',async()=>{
 const models:string[]=[];
 const complete=async (_prompt:string,model:string)=>{models.push(model);return {parsed:{...output,uncertain:true},usage:{prompt_tokens:500,completion_tokens:100},cost:10}};
 const result=await auditEditorialFlash(article,{cache:false,complete});
 assert.equal(result.review.status,'held');assert.deepEqual(models,['deepseek-flash']);
 await assert.rejects(auditEditorialFlash(article,{cache:false,complete:async()=>({parsed:{},usage:{},cost:1})}));
});
test('paid invalid output retains article attribution, cached tokens and settled cost',async()=>{
 let value:EditorialSpend={actualMicrocny:0,actualMicrousd:0,reservedMicrocny:0,calls:0,inputTokens:0,outputTokens:0,blocked:false,stages:{}};
 const store={read:async()=>structuredClone(value),write:async(_k:string,v:EditorialSpend)=>{value=structuredClone(v)}};
 await withEditorialBudget('test',1.5,async()=>{
  await withEditorialArticle(article.url,'hash',()=>editorialPaidRequest('integrated','deepseek-flash','body',650,0,async()=>Response.json({usage:{prompt_tokens:900,prompt_cache_hit_tokens:100,prompt_cache_miss_tokens:800,completion_tokens:200},choices:[{message:{content:'broken'}}]})));
  await markEditorialOutcome('hash','invalid_result_paid');
  const spent=await getEditorialSpend('test');assert.ok(spent.actualMicrocny>0);assert.equal(spent.reservedMicrocny,0);assert.equal(spent.requests?.[0].status,'invalid_result_paid');assert.equal(spent.requests?.[0].article,article.url);assert.equal(spent.requests?.[0].usage?.prompt_cache_hit_tokens,100);
 },store);
});
