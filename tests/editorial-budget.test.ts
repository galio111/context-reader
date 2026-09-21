import assert from 'node:assert/strict';
import test from 'node:test';
import { withEditorialBudget, editorialPaidRequest, getEditorialSpend, type EditorialSpend } from '../lib/editorialBudget';
import { editorialDailyReport } from '../lib/editorialReport';
import { articleMatchesRecommendationInterest, audienceStagesForReadingLevel } from '../lib/recommendationPreferences';
import type { PublicArticle } from '../types/publicArticle';
function fixture(){let value:EditorialSpend={actualMicrocny:0,actualMicrousd:0,reservedMicrocny:0,calls:0,inputTokens:0,outputTokens:0,blocked:false,stages:{}};return {read:async()=>structuredClone(value),write:async(_key:string,next:EditorialSpend)=>{value=structuredClone(next)}};}
test('provider ledger preserves free Jev usage and separately reserves unknown failures', async () => {
  const store = fixture();
  await withEditorialBudget('2026-09-21', Infinity, async () => {
    await editorialPaidRequest('Jev 对照', 'typesafe-ai/jev', 'article', 0, 0, async () => Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 0 }, gatewayCostUsd: 0 }));
    await editorialPaidRequest('DeepSeek 验证 Jev', 'deepseek-flash', 'article', 800, 0, async () => Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 10 } }));
    await assert.rejects(editorialPaidRequest('Jev 对照', 'typesafe-ai/jev', 'article', 0, 0, async () => { throw Error('timeout'); }));
    const spent = await getEditorialSpend('2026-09-21');
    assert.equal(spent.providers!.jev.microcny, 0);
    assert.equal(spent.providers!.jev.calls, 2);
    assert.equal(spent.providers!.jev.settledCalls, 1);
    assert.ok(spent.providers!.jev.reservedMicrocny > 0);
    assert.equal(spent.providers!.deepseek.microcny, spent.stages['DeepSeek 验证 Jev'].microcny);
    assert.equal(spent.reservedMicrocny, spent.providers!.jev.reservedMicrocny);
    assert.equal(spent.blocked, false);
  }, store);
});
test('cost ceiling rejects before provider dispatch and includes failed reservations',async()=>{const store=fixture();let calls=0;await withEditorialBudget('2026-09-21',0.01,async()=>{await assert.rejects(editorialPaidRequest('review','deepseek-v4-pro','article',800,0,async()=>{calls++;return Response.json({})}),/cost_limit/);assert.equal(calls,0);assert.equal((await getEditorialSpend('2026-09-21')).blocked,true)},store)});
test('provider usage settles reservation, records cached tokens and all pipeline costs',async()=>{const store=fixture();await withEditorialBudget('2026-09-21',1,async()=>{await editorialPaidRequest('classification','deepseek-flash','article',800,0,async()=>Response.json({usage:{prompt_tokens:1000,prompt_cache_hit_tokens:900,prompt_cache_miss_tokens:100,completion_tokens:10}}));let spent=await getEditorialSpend('2026-09-21');assert.equal(spent.reservedMicrocny,0);assert.equal(spent.calls,1);assert.equal(spent.inputTokens,1000);assert.ok(spent.actualMicrocny>0 && spent.actualMicrocny<1000);await assert.rejects(editorialPaidRequest('repair','deepseek-flash','article',800,0,async()=>{throw Error('timeout')}));spent=await getEditorialSpend('2026-09-21');assert.ok(spent.reservedMicrocny>0);assert.equal(spent.calls,2);const report=editorialDailyReport('2026-09-21',[],3,false,spent);assert.match(report.subject,/0\/30/);assert.match(report.text,/结果不明请求预留/);assert.match(report.text,/未入选/);},store)});
test('business preference uses article metadata rather than incidental title words',()=>{const business={title:'A new chapter',summary:'',sourceName:'',recommendation:{topics:['商业经济'],homepageCategory:'商业'}} as PublicArticle;assert.equal(articleMatchesRecommendationInterest(business,'business'),true);const culture={...business,title:'The market for ancient poetry',recommendation:{topics:['文化历史'],homepageCategory:'文化'}} as PublicArticle;assert.equal(articleMatchesRecommendationInterest(culture,'business'),false);assert.deepEqual(audienceStagesForReadingLevel('六级'),audienceStagesForReadingLevel('雅思/托福'));assert.deepEqual(audienceStagesForReadingLevel('考研'),audienceStagesForReadingLevel('雅思/托福'));});
