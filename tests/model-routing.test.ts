import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultModelConfig,validateModelConfig} from '../lib/modelCatalog';
import {withModelContext,setModelPlan,resolveModelRoute} from '../lib/modelSettings';
import {fetchWithProviderFailover,resetProviderCircuitForTests} from '../lib/providerFailover';
import {parseJevAnswers,JEV_TEXT_CHECKS} from '../lib/jevDirect';
import {distributionSatisfied} from '../lib/editorialDistribution';
import {estimateDeepSeekCostMicrocny} from '../lib/usageCost';
test('model capability validation rejects Jev generation, same fallback and nonvision image routes',()=>{
 const c=defaultModelConfig();c.routes.lookup.primary='jev-latest';assert.throws(()=>validateModelConfig(c));
 c.routes.lookup.primary='deepseek-flash';c.routes.lookup.fallback='deepseek-flash';assert.throws(()=>validateModelConfig(c));
 c.routes.lookup.fallback=null;c.routes.editorialVision.primary='glm-4.5-air';assert.throws(()=>validateModelConfig(c));
});
test('concurrent verified plan scopes cannot leak into other requests',async()=>{
 const c=defaultModelConfig();c.plans.plus={primary:'mimo-v2.6-flash',fallback:null};
 const result=await Promise.all(['plus','guest','plus','free'].map(plan=>withModelContext('summary',async()=>{setModelPlan(plan);await new Promise(r=>setTimeout(r,5));return (await resolveModelRoute()).primary;},c)));
 assert.deepEqual(result,['mimo-v2.6-flash','deepseek-flash','mimo-v2.6-flash','deepseek-flash']);
});
test('switch changes actual URL, secret and model; fallback once; 400 never switches',async t=>{
 const old=globalThis.fetch,env={...process.env};t.after(()=>{globalThis.fetch=old;process.env=env;resetProviderCircuitForTests();});
 process.env.DEEPSEEK_API_KEY='ds-test';process.env.MIMO_API_KEY='mimo-test';process.env.ZHIPU_API_KEY='glm-test';delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 const calls:Array<{url:string;model:string;auth:string|null;body:Record<string,unknown>}>=[];
 let status=200;
 globalThis.fetch=async(url,init)=>{const b=JSON.parse(String(init?.body));calls.push({url:String(url),model:b.model,auth:new Headers(init?.headers).get('Authorization'),body:b});return b.model==='mimo-v2.6-flash'&&status!==200?Response.json({error:'test'},{status}):Response.json({choices:[{message:{content:'ok'}}]});};
 const c=defaultModelConfig();c.routes.lookup={primary:'mimo-v2.6-flash',fallback:'glm-4.5-air'};
 const input={method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[],max_tokens:20})};
 await withModelContext('lookup',()=>fetchWithProviderFailover('https://api.deepseek.com/chat/completions',input),c);
 assert.equal(calls[0].url,'https://api.xiaomimimo.com/v1/chat/completions');assert.equal(calls[0].auth,'Bearer mimo-test');assert.equal(calls[0].body.max_completion_tokens,20);assert.equal(calls[0].body.max_tokens,undefined);
 status=503;calls.length=0;await withModelContext('lookup',()=>fetchWithProviderFailover('',input),c);assert.deepEqual(calls.map(x=>x.model),['mimo-v2.6-flash','glm-4.5-air']);assert.equal(calls[1].auth,'Bearer glm-test');
 resetProviderCircuitForTests();status=400;calls.length=0;assert.equal((await withModelContext('lookup',()=>fetchWithProviderFailover('',input),c)).status,400);assert.equal(calls.length,1);
});
test('Jev independent only at confidence boundaries; invalid data is not clean',()=>{
 const answers=Object.fromEntries(JEV_TEXT_CHECKS.map(k=>[k,{type:'noul',noul:.05}]));
 assert.equal(Object.keys(parseJevAnswers({answers})).length,4);
 answers.incomplete.noul=.5;assert.equal(parseJevAnswers({answers}).incomplete,undefined);
 answers.incomplete.noul=.99;assert.equal(parseJevAnswers({answers}).incomplete,true);
 answers.promotional.noul=NaN;assert.throws(()=>parseJevAnswers({answers}));
});
test('quantity cannot conceal a missing category; per-category maxima cap total at 68',()=>{
 assert.equal(distributionSatisfied({'时事':15,'科技':15,'文化':15,'商业':15}),true);
 assert.equal(distributionSatisfied({'时事':17,'科技':17,'文化':14,'商业':12}),false);
 assert.equal(distributionSatisfied({'时事':13,'科技':13,'文化':13,'商业':13}),false);
 assert.equal(distributionSatisfied({'时事':13,'科技':13,'文化':13,'商业':16}),true);
 assert.equal(distributionSatisfied({'时事':17,'科技':17,'文化':17,'商业':17}),true);
});
test('MiMo cached tokens and output use its own RMB rates, not DeepSeek time-of-day prices',()=>{
 assert.equal(estimateDeepSeekCostMicrocny('mimo-v2.6-flash',{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:500},completion_tokens:100}),710);
});
