import test from 'node:test';
import assert from 'node:assert/strict';
import { listAdminArticleSummaries, getArticleCandidate } from '../lib/publicArticles';
import { loadAdminCandidate } from '../lib/adminArticleClient';
import type { PublicArticle } from '../types/publicArticle';

test('Admin summaries paginate and omit body/block/cache columns; detail restores the chosen row', async () => {
 const original=globalThis.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://storage.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 const queries:URL[]=[];
 globalThis.fetch=async(input)=>{
  const u=new URL(String(input));queries.push(u);
  if(u.pathname.endsWith('/account_settings'))return Response.json([]);
  if(u.searchParams.has('id'))return Response.json([{id:'candidate',title:'One article',summary:'',body:'The chosen complete article is available for reading and editing.',source_url:'',source_name:'',published:false,created_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z'}]);
  const offset=Number(u.searchParams.get('offset')||0),size=Number(u.searchParams.get('limit')||1000),count=Math.min(size,1001-offset);
  return Response.json(Array.from({length:Math.max(0,count)},(_,i)=>({id:String(offset+i),title:'Article',summary:'Summary',source_url:'https://example.com/'+i,source_name:'Source',created_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z',difficulty:'高中 / CET-4',cefr:'B2',wordCount:500,topics:['文化历史'],manualFields:['cefr'],rejectedAt:offset+i===1000?'2026-10-12T01:00:00Z':null})));
 };
 try {
  const articles=await listAdminArticleSummaries(false);assert.equal(articles.length,1001);
  assert.ok(articles.every(a=>a.contentDeferred&&a.body===''&&(a.explanations?.length ?? 0)===0));
  assert.equal(articles.find(a=>a.id==='1000')?.recommendation?.rejectedAt,'2026-10-12T01:00:00Z');
  for(const u of queries.filter(u=>u.pathname.endsWith('/public_articles'))){const fields=u.searchParams.get('select')!.split(',');assert.ok(!fields.some(f=>['body','imported_article','explanations','articleTranslations'].includes(f)));}
  const row=await getArticleCandidate('candidate');assert.ok(row?.body.includes('complete article'));assert.ok(!row?.contentDeferred);assert.equal(queries.at(-1)?.searchParams.get('published'),'eq.false');
 } finally {globalThis.fetch=original;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
test('opening a deferred candidate requires complete content and reports missing or failed reads',async()=>{
 const original=globalThis.fetch;const summary={id:'candidate',contentDeferred:true,body:''} as PublicArticle;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({article:{...summary,contentDeferred:undefined,body:'Full content'}});};
 try{const full=await loadAdminCandidate(summary);assert.equal(full.body,'Full content');assert.equal(await loadAdminCandidate(full),full);assert.equal(calls,1);globalThis.fetch=async()=>Response.json({error:'Unavailable'},{status:503});await assert.rejects(loadAdminCandidate(summary),/候选正文/);}finally{globalThis.fetch=original;}
});
