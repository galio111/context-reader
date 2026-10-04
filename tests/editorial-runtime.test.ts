import assert from "node:assert/strict";
import test from "node:test";
import { listPublicArticleSummaries, publishArticleCandidate } from "../lib/publicArticles";
import { invalidatePublicReadCache } from "../lib/publicReadCache";
import { runEditorialBatch } from "../lib/editorialRunner";
import { getRecommendationAutomationStatus } from "../lib/recommendationAutomation";
import { shanghaiDay } from "../lib/discoveryPolicy";

function context(handler: typeof fetch) {
  const previous=globalThis.fetch;
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="http://supabase-api:8000";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
  globalThis.fetch=handler;invalidatePublicReadCache();
  return ()=>{globalThis.fetch=previous;invalidatePublicReadCache();if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;};
}

test("real public summary reads page through 1058 rows without requesting bodies",async()=>{
  const all=Array.from({length:1058},(_,i)=>({id:String(i),title:"Article "+i,summary:"Summary",source_url:"https://example.org/"+i,source_name:"Example",created_at:"2026-10-04T00:00:00Z",updated_at:"2026-10-04T00:00:00Z"}));
  let reads=0;
  const restore=context(async input=>{
    const u=new URL(String(input));assert.ok(!u.searchParams.get("select")?.split(",").includes("body"));
    reads++;const offset=Number(u.searchParams.get("offset") || 0),limit=Math.min(1000,Number(u.searchParams.get("limit") || 1000));
    return Response.json(all.slice(offset,offset+limit));
  });
  try {const rows=await listPublicArticleSummaries();assert.equal(rows.length,1058);assert.equal(rows.at(-1)?.id,"1057");assert.equal(reads,6);} finally {restore();}
});

test("guarded duplicate publication fails before any image storage or article mutation",async()=>{
  const candidate={id:"candidate",title:"Same article",summary:"Summary",body:"Text",source_url:"https://example.org/same",source_name:"Example",created_at:"2026-10-04T00:00:00Z",updated_at:"revision",published:false};
  let reads=0;
  const restore=context(async(input,init)=>{
    assert.ok(!init?.method || init.method==="GET","duplicate must not perform a mutation");
    const u=new URL(String(input));assert.ok(u.pathname.endsWith("/public_articles"));
    reads++;return Response.json(u.searchParams.get("published")==="eq.false"?[candidate]:[{...candidate,id:"old-public",published:true}]);
  });
  try {await assert.rejects(publishArticleCandidate("candidate",{expectedUpdatedAt:"revision"}),/已有相同公开文章/);assert.equal(reads,2);} finally {restore();}
});

test("unexpected batch failure closes today's ledger and requests today's report instead of inheriting yesterday's sent state",async()=>{
  const today=shanghaiDay();
  const values=new Map<string,unknown>([
    ["recommendation_automation_config",{enabled:true,runTime:"06:00",maxNewArticles:10}],
    ["recommendation_automation_state",{status:"running",lastEmailStatus:"sent",lastCreatedCount:48}],
    ["recommendation_editorial_config_v1",{enabled:true,dailyReviewLimit:240,dailyBudgetCny:1.5}],
    ["recommendation_discovery_sites_v2",[]],
    [`recommendation_editorial_day_${today}`,{startedAt:new Date().toISOString(),attempts:115,finished:false,sites:{}}],
  ]);
  let fail=true;
  const restore=context(async(input,init)=>{
    const u=new URL(String(input));
    if(u.pathname.endsWith("/public_articles")){
      if(fail){fail=false;throw new Error("simulated inventory transport failure");}
      return Response.json([]);
    }
    assert.ok(u.pathname.endsWith("/account_settings"));
    if(init?.method==="POST"){for(const row of JSON.parse(String(init.body)))values.set(row.key,row.value);return new Response(null,{status:204});}
    const filter=u.searchParams.get("key") || "";
    const keys=filter.startsWith("eq.")?[filter.slice(3)]:filter.slice(4,-1).split(",");
    return Response.json(keys.filter(k=>values.has(k)).map(key=>({key,value:values.get(key),updated_at:"2026-10-04T00:00:00Z"})));
  });
  try {
    assert.equal((await getRecommendationAutomationStatus()).state.lastEmailStatus,"not_requested");
    const result=await runEditorialBatch("https://context-reader.com","scheduled",{enabled:true,provider:"deepseek",dailyReviewLimit:240,dailyBudgetCny:1.5,jevMonthlyBudgetUsd:4},new Date());
    assert.equal(result.status.state.status,"failed");
    assert.equal((values.get(`recommendation_editorial_day_${today}`) as {finished:boolean}).finished,true);
    assert.ok(values.has(`recommendation_editorial_email_${today}_60_shortfall`));
    assert.notEqual(result.status.state.lastEmailStatus,"sent");
  } finally {restore();}
});
