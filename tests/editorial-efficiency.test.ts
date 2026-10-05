import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanEditorialFurniture,flashArticlePayload,parseFlashAudit,reusableFlashAudit} from '../lib/editorialFlash';
import {rankEditorialSources} from '../lib/editorialSourcePriority';
import type {ImportedArticle} from '../types/article';
import {supplyRetryDue,supplyRetryTime} from '../lib/editorialSupplyRetry';

const prose='Economic evidence explains the borrowing costs faced by households and companies. '.repeat(45);
const article:ImportedArticle={title:'The cost of borrowing',url:'https://insideclimatenews.org/news/example',siteName:'ICN',text:prose,blocks:[{id:'a',type:'paragraph',text:prose},{id:'b',type:'paragraph',text:'The evidence also has important limitations.'},{id:'img',type:'image',src:'https://example.com/photo.webp',alt:'Factories',caption:'A factory near the river.'}]};
const now=Date.parse('2026-10-05T00:00:00Z');
const result={category:3,topic:4,level:1,cefr:'B2',summary:'借贷成本的解释',evidence:[0,1],rationale:'讨论融资机制，语言 B2',confidence:'high',timely:false,eligible:true,specialist:false,imagesRelevant:true,uncertain:false,checks:{incomplete:false,contamination:false,orphanCaption:false,mediaDependent:false,promotional:false},reason:'clean'};
test('one later supply check stays within the same day and unused processing allowance',()=>{
 const early=Date.parse('2026-10-05T07:15:00+08:00');
 const retry=supplyRetryTime('2026-10-05',early,75*60_000);
 assert.equal(retry,'2026-10-05T02:00:00.000Z');
 const ledger={finished:true,nextSupplyRetryAt:retry};
 assert.equal(supplyRetryDue(ledger,early),false);assert.equal(supplyRetryDue(ledger,Date.parse(retry!)),true);
 assert.equal(supplyRetryDue({...ledger,suspended:true},Date.parse(retry!)),false);
 assert.equal(supplyRetryDue({...ledger,supplyRetryCount:1},Date.parse(retry!)),false);
 assert.equal(supplyRetryTime('2026-10-05',early,120*60_000),undefined);
 assert.equal(supplyRetryTime('2026-10-05',Date.parse('2026-10-05T17:30:00+08:00'),75*60_000),undefined);
});
test('exact approvals survive a 24h boundary but never the 48h publication boundary',()=>{
 const old=parseFlashAudit(article,result);old.review.checkedAt=new Date(now-25*3600_000).toISOString();
 assert.equal(reusableFlashAudit(article,old,now),old);
 assert.equal(reusableFlashAudit(article,old,now+23*3600_000),null);
 assert.equal(reusableFlashAudit({...article,blocks:[...article.blocks,{id:'extra',type:'paragraph',text:'An edited paragraph.'}]},old,now),null);
 old.review.checkedAt=new Date(now+1000).toISOString();assert.equal(reusableFlashAudit(article,old,now),null);
});
test('unchanged held content remains held without paying every day; old news fails before payment',()=>{
 const dated={...article,publishedTime:'2026-09-01T00:00:00Z'};
 const held=parseFlashAudit(dated,{...result,uncertain:true});held.review.checkedAt=new Date(now-3*86400_000).toISOString();
 assert.equal(reusableFlashAudit(dated,held,now)?.review.status,'held');
 assert.equal(reusableFlashAudit(dated,held,now+4*86400_000),null);
 held.classification.timeliness='time-sensitive';assert.throws(()=>reusableFlashAudit(dated,held,now),/超过 7 天/);
});
test('compact audit payload preserves all text, tables, superscripts, image captions and block indices',()=>{
 const rich={...article,blocks:[...article.blocks,{id:'sup',type:'paragraph' as const,text:'CO2 emissions',inline:[{text:'CO'},{text:'2',baseline:'sub' as const},{text:' emissions'}]},{id:'t',type:'table' as const,table:{rows:[[{text:'Loss',header:true},{text:'20%'}]]}}]};
 const payload=JSON.parse(flashArticlePayload(rich));
 assert.deepEqual(payload.blocks.map((b:unknown[])=>b[0]),[0,1,2,3,4]);
 assert.equal(payload.blocks[0][2],prose);assert.equal(payload.blocks[2][2].caption,article.blocks[2].caption);
 assert.deepEqual(payload.blocks[3][2].inline,rich.blocks[3].inline);assert.deepEqual(payload.blocks[4][2].table,rich.blocks[4].table);
});
test('inspected ICN paired fundraiser and footer are removed; intervening article prose and quotes survive',()=>{
 const fundraising=[{id:'h',type:'subheading' as const,text:'This story is funded by readers like you.'},{id:'d',type:'paragraph' as const,text:'Our nonprofit newsroom provides award-winning climate coverage free of charge and advertising. We rely on donations from readers like you to keep going. Please donate now to support our work.'}];
 const noisy={...article,blocks:[...article.blocks,...fundraising,{id:'after',type:'paragraph' as const,text:'The industry disputes the conclusions.'},{id:'quote',type:'quote' as const,text:fundraising[1].text},{id:'f',type:'subheading' as const,text:'About This Story'},{id:'f2',type:'paragraph' as const,text:'Perhaps you noticed: This story, like all the news we publish, is free to read. That’s because Inside Climate News is a nonprofit.'},{id:'f3',type:'paragraph' as const,text:'Donations from readers like you fund every aspect of what we do.'}]};
 const clean=cleanEditorialFurniture(noisy);assert.ok(!clean.blocks.some(b=>b.type==='paragraph' && b.text===fundraising[1].text));assert.ok(!clean.text.includes('Perhaps you noticed:'));assert.ok(clean.text.includes('The industry disputes the conclusions.'));assert.ok(clean.blocks.some(b=>b.type==='quote' && b.text===fundraising[1].text));
 assert.equal(cleanEditorialFurniture({...noisy,url:'https://another.org/story'}).blocks.length,noisy.blocks.length);
 const incomplete={...noisy,blocks:noisy.blocks.filter(b=>b.id!=='f3')};assert.ok(cleanEditorialFurniture(incomplete).text.includes('Perhaps you noticed:'));
});
test('the new Nieman footer boundary needs both exact latest-heading and foundation footer evidence',()=>{
 const base={...article,url:'https://www.niemanlab.org/example',blocks:[...article.blocks,...Array.from({length:4},(_,i)=>({id:'more'+i,type:'paragraph' as const,text:'Article reporting continues.'})),{id:'date',type:'paragraph' as const,text:'September 3, 2026\n\nSee more on Reporting & Production'},{id:'latest',type:'subheading' as const,text:'The latest from Nieman Lab'},{id:'footer',type:'paragraph' as const,text:'Help advance the Nieman Foundation’s mission by making a donation.'}]};
 const clean=cleanEditorialFurniture(base);assert.ok(!clean.text.includes('See more on'));assert.ok(!clean.text.includes('The latest from Nieman Lab'));assert.equal(clean.blocks.filter(b=>b.type==='image').length,1);
 assert.equal(cleanEditorialFurniture({...base,blocks:base.blocks.filter(b=>b.id!=='footer')}).blocks.length,base.blocks.length-1);
});
test('real approved business output can fill the deficit even if the feed lacks a business hint',()=>{
 const site={id:'climate',topics:['自然环境','社会生活'],enabled:true,verification:{ok:true},levelHint:'mixed'};
 const counts={'时事':14,'科技':17,'文化':15,'商业':12};
 assert.equal(rankEditorialSources([site],counts,{}, {climate:{total:10,categories:{'商业':2}}}).length,1);
 assert.equal(rankEditorialSources([site],counts,{}, {climate:{total:10,categories:{'时事':10}}}).length,0);
});
