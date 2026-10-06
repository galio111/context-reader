import test from 'node:test';
import assert from 'node:assert/strict';
import { captureEditorialSource, queuedFeedItems, recordEditorialIntake, readEditorialIntake, retryEditorialIntake, pollEditorialFeeds } from '../lib/editorialIntake';
import { applyIntakeFailure, EditorialIntakeError, intakeDue, type IntakeEntry } from '../lib/editorialIntakePolicy';
import type { DiscoverySite } from '../lib/discoveryStore';
import type { FeedItem } from '../lib/recommendationFeed';
import { rankEditorialSources } from '../lib/editorialSourcePriority';

const site: DiscoverySite = {id:'time-com',name:'TIME',enabled:true,verification:{ok:true,at:'',message:'',samples:[]},feeds:['https://time.com/feed/'],feedUrl:'https://time.com/feed/',articleHosts:['time.com'],topics:['社会生活'],levelHint:'advanced',discovery:'feed',dailyTarget:2,note:''};
const item = (slug: string): FeedItem => ({url:`https://time.com/article/${slug}`,title:`An analytical article about ${slug}`,description:'Full reporting',publishedAt:new Date().toISOString(),source:site,relevance:0});
const entry: IntakeEntry = {...item('first'),firstSeenAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attempts:0,state:'waiting'};

test('network, parser and model failures retry, then retain attention; advertising alone is a content rejection',()=>{
  const now=Date.now();
  let row=applyIntakeFailure(entry,Error('model JSON response invalid'),'review',now);
  assert.equal(row.state,'retry');assert.equal(intakeDue(row,now),false);assert.equal(intakeDue(row,now+3600_000),true);
  row=applyIntakeFailure(row,Error('network timeout'),'import',now+3600_000);
  assert.equal(row.state,'retry');assert.equal(intakeDue(row,now+2*3600_000),false);
  row=applyIntakeFailure(row,Error('image unavailable'),'images',now+7*3600_000);
  assert.equal(row.state,'attention');assert.equal(row.attempts,3);assert.equal(intakeDue(row,now+30*86400_000),false);
  assert.equal(applyIntakeFailure(entry,new EditorialIntakeError('全文是售票广告','content_rejected'),'review').state,'rejected');
  assert.equal(applyIntakeFailure(entry,new EditorialIntakeError('新闻超过 7 天','policy_skipped'),'review').state,'skipped');
});

test('a feed rotation or outage cannot lose discovered URLs; retry and duplicate resolution survive reload',async()=>{
  const values=new Map<string,unknown>(), oldFetch=globalThis.fetch;
  const env=[process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL='http://supabase-api:8000';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.ok(url.pathname.endsWith('/account_settings'));
    if(init?.method==='POST'){for(const r of JSON.parse(String(init.body)))values.set(r.key,structuredClone(r.value));return new Response(null,{status:204});}
    const k=url.searchParams.get('key')!.slice(3);return Response.json(values.has(k)?[{value:values.get(k)}]:[]);
  };
  try {
    await captureEditorialSource(site,1,true,async()=>[item('first'),item('first')]);
    await recordEditorialIntake(item('first'),{error:Error('image timeout'),stage:'images'});
    await captureEditorialSource(site,1,true,async()=>[item('second')]);
    let stored=await readEditorialIntake(site.id);
    assert.equal(Object.keys(stored.entries).length,2);assert.equal(stored.entries[entry.url].state,'retry');
    assert.deepEqual(queuedFeedItems(site,stored,Date.now()+3600_000+10).map(i=>i.url),[entry.url,item('second').url]);
    await captureEditorialSource(site,1,true,async()=>{throw Error('Feed unavailable');});
    stored=await readEditorialIntake(site.id);assert.equal(Object.keys(stored.entries).length,2);assert.equal(stored.feedErrors.length,1);
    await retryEditorialIntake(site.id,entry.url);
    assert.equal((await readEditorialIntake(site.id)).entries[entry.url].state,'waiting');
    await recordEditorialIntake(item('first'),{candidateId:'candidate-id'});
    assert.equal(queuedFeedItems(site,await readEditorialIntake(site.id)).length,1);
    await assert.rejects(retryEditorialIntake(site.id,entry.url),/不是待处理/);
    await recordEditorialIntake(item('second'),{skipped:'已发布'});
    assert.equal(queuedFeedItems(site,await readEditorialIntake(site.id)).length,0);
    let scans=0; const now=Date.now();
    const scan=async()=>{scans++;return readEditorialIntake(site.id);};
    await pollEditorialFeeds([site],now,scan);assert.equal(scans,1);
    await pollEditorialFeeds([site],now+30_000,scan);assert.equal(scans,1);
    await pollEditorialFeeds([site],now+3600_001,scan);assert.equal(scans,2);
    await pollEditorialFeeds([{...site,enabled:false}],now+7200_002,scan);assert.equal(scans,2);
  } finally {
    globalThis.fetch=oldFetch;
    for(const [i,key] of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].entries())if(env[i]===undefined)delete process.env[key];else process.env[key]=env[i];
  }
});

test('queued TIME articles survive former visit and category caps while disabled sites remain off',()=>{
  const counts={时事:50,科技:20,文化:20,商业:20};
  assert.equal(rankEditorialSources([{...site,pendingCount:40}],counts,{[site.id]:{visits:10,empty:3}}).length,1);
  assert.equal(rankEditorialSources([{...site,pendingCount:40,enabled:false}],counts,{}).length,0);
});
