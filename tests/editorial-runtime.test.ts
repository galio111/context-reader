import assert from "node:assert/strict";
import test from "node:test";
import { listPublicArticleSummaries, publishArticleCandidate } from "../lib/publicArticles";
import { invalidatePublicReadCache } from "../lib/publicReadCache";
import { reportEditorialRecovery, runEditorialBatch } from "../lib/editorialRunner";
import { getRecommendationAutomationStatus } from "../lib/recommendationAutomation";
import { shanghaiDay } from "../lib/discoveryPolicy";

function context(handler: typeof fetch) {
  const previous=globalThis.fetch;
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="http://supabase-api:8000";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
  globalThis.fetch=handler;invalidatePublicReadCache();
  return ()=>{globalThis.fetch=previous;invalidatePublicReadCache();if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;};
}

test('later supply retry retains spend, attempts and excluded URLs and cannot schedule a second retry',async()=>{
 const today=shanghaiDay(),at=new Date().toISOString(),dayKey=`recommendation_editorial_day_${today}`;
 const articles=Array.from({length:58},(_,i)=>({id:'retry-'+i,title:'Reported article '+i,body:'An authentic article.',published:true,created_at:at,updated_at:at,imported_article:{title:'Reported article '+i,text:'An authentic article.',url:'https://example.org/'+i,blocks:[],recommendation:{autoPublishedAt:at,homepageCategory:i<14?'时事':i<31?'科技':i<46?'文化':'商业'}}}));
 const ledger={finished:true,attempts:209,startedAt:at,processingMs:75*60_000,nextSupplyRetryAt:new Date(Date.now()-1000).toISOString(),sites:{source:{visits:6,empty:2,urls:['https://example.org/attempted']}}};
 const spent={calls:100,actualMicrocny:463481,actualMicrousd:69523,reservedMicrocny:0,inputTokens:442000,outputTokens:18610,blocked:false,stages:{}};
 const values=new Map<string,unknown>([[dayKey,ledger],[`recommendation_editorial_spend_${today}`,spent],['homepage_publication_curation',{selectedAtById:Object.fromEntries(articles.map(a=>[a.id,at]))}],['recommendation_discovery_sites_v2',[]],['recommendation_automation_config',{enabled:true,runTime:'06:00',maxNewArticles:60}],['recommendation_automation_state',{lastStartedAt:at,status:'failed'}],[`recommendation_editorial_email_${today}_60_shortfall`,{status:'sent',at:1,count:58}]]);
 const restore=context(async(input,init)=>{
  const u=new URL(String(input));
  if(u.pathname.endsWith('/public_articles'))return Response.json(u.searchParams.get('published')==='eq.false'?[]:articles);
  assert.ok(u.pathname.endsWith('/account_settings'));
  if(init?.method==='POST'){for(const row of JSON.parse(String(init.body)))values.set(row.key,row.value);return new Response(null,{status:204});}
  const filter=u.searchParams.get('key')||'',keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.slice(4,-1).split(',');
  return Response.json(keys.filter(k=>values.has(k)).map(key=>({key,value:values.get(key),updated_at:at})));
 });
 try {
  const result=await runEditorialBatch('https://context-reader.com','scheduled',{enabled:true,provider:'deepseek',jevMonthlyBudgetUsd:4,dailyReviewLimit:240,dailyBudgetCny:1.5},new Date());
  assert.equal(result.status.state.lastCreatedCount,58);
  const revised=values.get(dayKey) as typeof ledger & {supplyRetryCount:number};
  assert.equal(revised.attempts,209);assert.equal(revised.supplyRetryCount,1);assert.equal(revised.nextSupplyRetryAt,undefined);
  assert.deepEqual(revised.sites.source.urls,ledger.sites.source.urls);assert.ok(revised.processingMs>=75*60_000 && revised.processingMs<76*60_000);
  assert.equal(values.get(`recommendation_editorial_spend_${today}`),spent);
  const closed=await runEditorialBatch('https://context-reader.com','scheduled',{enabled:true,provider:'deepseek',jevMonthlyBudgetUsd:4,dailyReviewLimit:240,dailyBudgetCny:1.5},new Date());
  assert.equal(closed.skipped,'already_ran_today');assert.equal(values.get(dayKey),revised);
 } finally {restore();}
});

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


test("final recovery report includes approved backlog selections and preserves sent-report idempotency",async()=>{
  const today=shanghaiDay(),at=new Date().toISOString();
  const articles=Array.from({length:85},(_,i)=>({id:String(i),title:"Article "+i,summary:"Summary",body:"Reading",source_url:"https://example.org/"+i,source_name:"Example",created_at:at,updated_at:at,recommendation:{topics:["社会生活"],difficulty:"CET-6 / 考研",homepageCategory:i<35?"时事":i<50?"科技":i<65?"文化":"商业"}}));
  const values=new Map<string,unknown>([
    ["homepage_publication_curation",{selectedAtById:Object.fromEntries(articles.map(a=>[a.id,at]))}],
    ["recommendation_automation_config",{enabled:true,runTime:"06:00",maxNewArticles:60}],
    ["recommendation_automation_state",{status:"succeeded",lastCreatedCount:77,lastEmailStatus:"sent"}],
    ["recommendation_editorial_config_v1",{enabled:true,dailyReviewLimit:240,dailyBudgetCny:1.5}],
    ["recommendation_discovery_sites_v2",[]],
    [`recommendation_editorial_day_${today}`,{finished:true,attempts:130}],
    [`recommendation_editorial_email_${today}_60_complete`,{status:"sent",at:1,count:77}],
  ]);
  const smtpNames=["SITE_SMTP_HOST","ERROR_ALERT_SMTP_HOST","SITE_SMTP_USER","ERROR_ALERT_SMTP_USER","SITE_NOTIFICATION_EMAIL_TO"];
  const saved=Object.fromEntries(smtpNames.map(k=>[k,process.env[k]]));smtpNames.forEach(k=>delete process.env[k]);
  const restore=context(async(input,init)=>{
    const u=new URL(String(input));
    if(u.pathname.endsWith("/public_articles"))return Response.json(articles);
    assert.ok(u.pathname.endsWith("/account_settings"));
    if(init?.method==="POST"){for(const row of JSON.parse(String(init.body)))values.set(row.key,row.value);return new Response(null,{status:204});}
    const filter=u.searchParams.get("key") || "";const keys=filter.startsWith("eq.")?[filter.slice(3)]:filter.slice(4,-1).split(",");
    return Response.json(keys.filter(k=>values.has(k)).map(key=>({key,value:values.get(key),updated_at:at})));
  });
  try {
    const first=await reportEditorialRecovery();assert.equal(first.count,85);assert.equal(first.complete,true);assert.equal(first.counts["商业"],20);
    assert.equal((values.get("recommendation_automation_state") as {lastCreatedCount:number}).lastCreatedCount,85);
    const key=`recommendation_editorial_email_${today}_60_complete_recovery`;
    assert.equal((values.get(key) as {count:number}).count,85);
    const delivered={status:"sent",at:Date.now(),count:85};values.set(key,delivered);
    assert.equal((await reportEditorialRecovery()).email?.status,"sent");assert.equal(values.get(key),delivered);
  } finally {restore();for(const k of smtpNames){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
