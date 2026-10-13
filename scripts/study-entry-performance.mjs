import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fsrs,createEmptyCard } from "ts-fsrs";
import { compactStudyResponse } from "../lib/studyTransport.ts";
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require("playwright");
const output=process.env.STUDY_OUTPUT?pathToFileURL(resolve(process.env.STUDY_OUTPUT)+"/"):new URL("../artifacts/study-entry-performance/",import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const owner="9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721";
const base={phonetic:"/ˈflʌrɪʃ/",lemma:"flourish",partOfSpeech:"verb",basicMeaning:"繁荣；茁壮成长",contextMeaning:"茁壮成长",sentenceTranslation:"植物在适当的环境中茁壮成长。",usageNote:"常用于描述生物、事业与文化的发展。",collocation:"flourish in",exampleEnglish:"Creativity can flourish here.",exampleChinese:"创造力可以在这里蓬勃发展。",previousSentence:"",nextSentence:"",difficulty:"medium",shouldAddToVocabulary:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const entries=["flourish","resilient","contemplate"].map((word,i)=>({...base,id:"test-"+i,word,sourceSentence:i===0?"Plants flourish in the right conditions.":"",sourceArticle:i===0?{kind:"public",id:"study-example",title:"A reading example"}:undefined,anki:{cardMode:i===0?"cloze_context":"basic_en_to_cn",clozeSentence:"Plants ________ in the right conditions.",contextCue:"茁壮成长",basicCue:"繁荣",frontPreview:"",backPreview:"",canMakeCloze:i===0}}));
const settings={reviewsPerDay:100,forgotMinutes:5,unsureMinutes:10,retention:.9,pausedUntil:null,reminders:true,includeAnki:false};
let snapshot={serverNow:new Date().toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:e.anki.cardMode,memory:JSON.parse(JSON.stringify(createEmptyCard(new Date()))),version:0,suspended:false,anki_pending:false,created_at:e.createdAt})),entries,today:null,reviews:[],daily:[{day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),cards:12,new_cards:5,review_cards:7,reviews:18,successes:15,active_ms:180000}],streak:{current:0,best:0,last_day:null},rewards:[],claims:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[{days:2,points:50,plan:null,months:0}],profileEnabled:true,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
let syncDelayed=false;let firstStartAt=0;let firstResponseAt=0;let quickAnswerGuardTested=false;let starts=0;let failSettings=false;let settingsDelay=0;
let holdStart=false, releaseStart, heldStart, failStart=false, syncCalls=0, presentConflicts=0;
let holdReview=false, releaseReview;
const stamp=()=>({...snapshot,serverNow:new Date().toISOString()});
const account={configured:true,authenticated:true,profile:{userId:owner,nickname:"学习测试",status:"active",email:"",phone:"",readingInterests:[]},plan:{id:"free",displayName:"免费账号",priceCny:0,active:true,limits:[]},usage:[]};
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 const json=async data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(route.request().headers()["x-study-format"]==="compact-v1"?compactStudyResponse(data):data)});
 if(p==="/api/auth/session")return json({account});
 if(p==="/api/account/sync"){syncCalls++;if(!syncDelayed){syncDelayed=true;await new Promise(r=>setTimeout(r,5000));}return json({objects:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false});}
 if(p==="/api/study"){
  if(route.request().method()==="GET"){
   if(url.searchParams.has("entry"))return json({entry:snapshot.entries.find(e=>e.id===url.searchParams.get("entry"))});
   if(url.searchParams.get("summary")==="1")return json({settings:snapshot.settings,today:snapshot.today?{day:snapshot.today.day,completed_at:snapshot.today.completed_at}:null});
   return json(stamp());
  }
  const b=route.request().postDataJSON();
  if(b.op==="start"){
   starts++;firstStartAt ||= Date.now();
   if(failStart){failStart=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'学习记录暂时无法读取或保存，请稍后重试。进度不会被自动重置。'})});}
   snapshot.today??={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.map(c=>c.id),new_completed:0,streak:0,settings:{...settings},completed_at:null,reward_points:0};
   const captured=structuredClone(stamp());
   if(holdStart){holdStart=false;heldStart=new Promise(r=>releaseStart=r);await heldStart;}else await new Promise(r=>setTimeout(r,starts===1?500:2500));
   firstResponseAt ||= Date.now();return json(captured);
  }
  if(b.op==="present"){
   const current=snapshot.cards.find(c=>c.id===b.cardId);
   if(!current||current.suspended)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'这个词条已移除。',code:'state_changed'})});
   if(current.version!==b.version){presentConflicts++;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'这张卡片已变化，请刷新后继续。'})});}
   return json({token:randomUUID(),shownAt:new Date().toISOString()});
  }
  if(b.op==="review"&&!quickAnswerGuardTested){quickAnswerGuardTested=true;return route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"请先回忆并核对答案，再记录结果。",code:"too_fast"})});}
  if(b.op==='review'&&holdReview){holdReview=false;await new Promise(resolve=>releaseReview=resolve);}
  if(b.op==="review"){const card=snapshot.cards.find(c=>c.id===b.cardId);const rating=b.answer==="forgot"||b.answer==="unsure_wrong"?1:b.answer==="unsure_right"?2:3;const old=structuredClone(card.memory);const scheduler=fsrs({request_retention:.9,enable_fuzz:false,learning_steps:["5m","10m"],relearning_steps:["5m"]});card.memory=JSON.parse(JSON.stringify(scheduler.next(card.memory,new Date(),rating).card));card.version++;snapshot.reviews.unshift({id:b.id,card_id:card.id,answer:b.answer,rating,reviewed_at:new Date().toISOString(),active_ms:b.activeMs,undone:false,previous:old,next:card.memory});return json({saved:true,id:b.id,snapshot:stamp()});}
  if(b.op==="claimReward"){const c=snapshot.claims.find(c=>c.id===b.id);const points=c.points-c.claimed_points;c.claimed_points=c.points;c.claimed_at=new Date().toISOString();return json({claimed:{claimed:true,points},snapshot:stamp()});}
  if(b.op==="pause"){snapshot.settings={...snapshot.settings,pausedUntil:new Date(Date.now()+b.days*86400000).toISOString()};return json(stamp());}
  if(b.op==="resume"){snapshot.settings={...snapshot.settings,pausedUntil:null};return json(stamp());}
  if(b.op==="settings"){if(settingsDelay)await new Promise(r=>setTimeout(r,settingsDelay));if(failSettings){failSettings=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"暂时无法保存"})});}snapshot.settings=b.settings;return json(stamp());}
  if(b.op==="undo"){const r=snapshot.reviews.find(r=>r.id===b.id),c=snapshot.cards.find(c=>c.id===r.card_id);c.memory=r.previous;c.version++;r.undone=true;return json(stamp());}
  return json(stamp());
 }
 if(p==="/api/study/profile")return json({activeSeconds:4200,uniqueLookups:56,eligible:true});
 if(p==="/api/public-articles/study-example")return json({article:{id:"study-example",title:"A reading example",body:"Plants flourish in the right conditions.\n\nA small garden can teach us to look closely at the world.",sourceName:"Study QA",summary:"A small garden",preloadedExplanations:[],preloadedArticleTranslations:[]}});
 if(p==="/api/public-articles")return json({articles:[]});
 if(p==="/api/admin/session")return json({authenticated:false});
 if(p==="/api/connectivity")return json({ok:true});
 if(p==="/api/public-articles/daily-updates")return json({count:0,articles:[]});
 if(p==="/api/pronunciation")return route.fulfill({status:503,contentType:"application/json",body:'{"error":"test pronunciation unavailable"}'});
 return json({});
});

const label=process.env.STUDY_LABEL||"after";
try {
 const errorsBefore=errors.length;
 await page.goto((process.env.STUDY_BASE||"http://127.0.0.1:3226")+"/?study=1",{waitUntil:"domcontentloaded",timeout:120000});
 const study=page.getByRole("dialog",{name:"背单词",exact:true});
 const answer=study.getByRole("button",{name:/模糊/});
 await answer.waitFor({timeout:90000});
 const shownAt=Date.now();
 const disabledAfterSnapshot=await answer.isDisabled();
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.includes('模糊'));return b&&!b.disabled;},{},{timeout:45000});
 const enabledAt=Date.now();
 await study.getByRole('button',{name:'返回阅读',exact:true}).last().click();
 const previousStarts=starts;const reopenAt=Date.now();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader-open-study')));
 await answer.waitFor();
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.includes('模糊'));return b&&!b.disabled;},{},{timeout:20000});
 const reopenedAt=Date.now();
 const report={label,firstCardAfterStartMs:shownAt-firstStartAt,firstEnabledAfterStartMs:enabledAt-firstStartAt,extraWaitAfterSnapshotMs:enabledAt-firstResponseAt,disabledAfterSnapshot,reopenEnabledMs:reopenedAt-reopenAt,reopenStartRequests:starts-previousStarts};
 await page.screenshot({path:fileURLToPath(new URL(label+'-desktop.png',output))});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:fileURLToPath(new URL(label+'-mobile.png',output))});
 report.mobileOverflow=await study.evaluate(e=>e.scrollWidth>e.clientWidth+1);
 if(label!=='before'){
  if(report.disabledAfterSnapshot||report.reopenEnabledMs>700||report.reopenStartRequests!==0)throw Error('Entry remains blocked');
  await study.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'生词本',exact:true}).click();
  const rows=study.locator('ul[class*="vocabularyRows"] > li');
  const words=()=>rows.locator('strong').allTextContents();
  if((await words()).join(',')!=='flourish,resilient,contemplate')throw Error('Default collection order changed');
  await study.getByRole('button',{name:'字母 A–Z',exact:true}).click();
  if((await words()).join(',')!=='contemplate,flourish,resilient')throw Error('Alphabetical order incorrect');
  const beforeSortRequests=starts;
  let previous=(await words()).join(',');
  for(let i=0;i<4;i++){
   await study.getByRole('button',{name:'随机',exact:true}).click();
   const current=(await words()).join(',');if(current===previous)throw Error('Random click repeated visible order');previous=current;
  }
  await study.getByRole('button',{name:'随机',exact:true}).focus();
  await page.keyboard.press('Enter');
  if((await words()).join(',')===previous)throw Error('Keyboard shuffle repeated order');
  await study.getByRole('button',{name:'隐藏英文',exact:true}).click();
  await rows.first().getByRole('button',{name:'显示英文',exact:true}).click();
  const revealedWord=await rows.locator('strong').allTextContents();
  await study.getByRole('button',{name:'随机',exact:true}).click();
  if((await rows.locator('strong').allTextContents()).join(',')!==revealedWord.join(','))throw Error('Shuffle detached masking from entry identity');
  await study.getByRole('button',{name:'显示英文',exact:true}).first().click();
  await study.getByRole('button',{name:'收藏顺序',exact:true}).click();
  if((await words()).join(',')!=='flourish,resilient,contemplate'||starts!==beforeSortRequests)throw Error('Sorting reloaded or changed saved order');
  await page.screenshot({path:fileURLToPath(new URL(label+'-vocabulary-mobile.png',output))});
  if(await study.evaluate(e=>e.scrollWidth>e.clientWidth+1))throw Error('Vocabulary sort overflows on mobile');
  await page.setViewportSize({width:1440,height:960});
  await page.screenshot({path:fileURLToPath(new URL(label+'-vocabulary-desktop.png',output))});
  report.vocabularyOrder={defaultCollected:true,alphabetical:true,repeatedShuffle:true,keyboard:true,maskIdentity:true,noReload:true};
  await study.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'背单词',exact:true}).click();
  // Keep an old server reply in flight while a real UI answer is submitted.
  await page.setViewportSize({width:1440,height:960});
  await new Promise(r=>setTimeout(r,5500));
  holdStart=true;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader:account-data-merged',{detail:{kinds:['vocabulary']}})));
  for(let i=0;i<100&&!releaseStart;i++)await new Promise(r=>setTimeout(r,30));
  if(!releaseStart)throw Error('Background refresh not requested');
  if(await answer.isDisabled())throw Error('Background refresh blocks answers');
  await answer.click();await study.getByRole('button',{name:'答对了',exact:true}).click();
  await study.getByText('resilient',{exact:true}).waitFor();
  releaseStart();await new Promise(r=>setTimeout(r,300));
  if(!await study.getByText('resilient',{exact:true}).isVisible())throw Error('Old background reply overwrote the saved answer');
  await new Promise(r=>setTimeout(r,2800));
  if(snapshot.reviews.length!==1||snapshot.cards[0].version!==1)throw Error('Review was lost or duplicated');
  report.backgroundRacePreservedReview=true;
  const priorSync=syncCalls, priorStart=starts;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader:account-data-changed',{detail:{kinds:['vocabulary']}})));
  // AccountProvider may already hold an idle-deferred sync (bounded at 30 s).
  // Study remains interactive while its vocabulary-only follow-up waits.
  for(let i=0;i<800&&starts===priorStart;i++)await new Promise(r=>setTimeout(r,50));
  if(starts<=priorStart)throw Error('New local words do not refresh after syncing: '+JSON.stringify({priorSync,syncCalls,priorStart,starts}));
  await new Promise(r=>setTimeout(r,2800));
  report.localChangeRefresh=true;
  const beforeRemoteRefresh=starts;snapshot.cards[1].version++;
  await study.getByRole('button',{name:'返回阅读',exact:true}).last().click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader-open-study')));
  for(let i=0;i<100&&starts===beforeRemoteRefresh;i++)await new Promise(r=>setTimeout(r,30));
  await new Promise(r=>setTimeout(r,2800));
  if(!presentConflicts||starts===beforeRemoteRefresh||!await study.getByText('resilient',{exact:true}).isVisible())throw Error('Retained stale card did not recover from server version conflict');
  await answer.click();await study.getByRole('button',{name:'答对了',exact:true}).waitFor();
  if(await study.getByRole('button',{name:'答对了',exact:true}).isDisabled())throw Error('New version has no valid presentation token');
  report.remoteVersionRecovery=true;
  failStart=true;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader:account-data-merged',{detail:{kinds:['vocabulary']}})));
  await study.getByRole('alert').waitFor();
  if(await study.getByRole('button',{name:'答对了',exact:true}).isDisabled())throw Error('Background failure cleared or blocked existing card');
  report.backgroundFailurePreservesCard=true;
  // Legacy pending answers migrate into the durable outbox and drain automatically.
  // Hold that write: the initial snapshot must still expose the next recall card.
  const c=snapshot.cards[1];
  await page.evaluate(({owner,pending})=>sessionStorage.setItem('context-reader-study-pending:'+owner,JSON.stringify(pending)),{owner,pending:{op:'review',id:randomUUID(),cardId:c.id,version:c.version,token:randomUUID(),answer:'remembered',activeMs:3000}});
  holdReview=true;const pendingReloadAt=Date.now();
  await page.goto((process.env.STUDY_BASE||"http://127.0.0.1:3226")+'/?study=1',{waitUntil:'domcontentloaded'});
  await study.getByText('contemplate',{exact:true}).waitFor({timeout:10000});
  report.pendingInitialSnapshotMs=Date.now()-pendingReloadAt;
  if(!releaseReview||await answer.isDisabled())throw Error('Pending write blocks first snapshot or recall');
  releaseReview();
  await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('context-reader-study-outbox:')));
  report.pendingRecovery=true;
  await new Promise(r=>setTimeout(r,200));
  await study.getByRole('button',{name:'返回阅读',exact:true}).last().click();
  snapshot.cards=snapshot.cards.filter(c=>c.entry_id!=='test-2');
  const beforeDeletedRefresh=starts;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader-open-study')));
  for(let i=0;i<100&&starts===beforeDeletedRefresh;i++)await new Promise(r=>setTimeout(r,30));
  await new Promise(r=>setTimeout(r,2800));
  if(starts===beforeDeletedRefresh||await study.getByText('contemplate',{exact:true}).count())throw Error('Deleted retained card did not refresh');
  report.deletedCardRecovery=true;
  // Exercise actual React/DOM reordering, not only the small shuffle helper.
  snapshot.entries=Array.from({length:2000},(_,i)=>({...entries[1],id:'large-'+i,word:'word-'+String(2000-i).padStart(4,'0'),contextMeaning:i%4===0?'这是一条较长的中文释义，用于检查不同内容高度在手机窄屏上换行以后仍然完整展示，没有重叠或空白。'.repeat(3):'茁壮成长',createdAt:new Date(1600000000000+i*1000).toISOString()}));
  snapshot.cards=snapshot.entries.map((e,i)=>({...snapshot.cards[0],id:String(i).padStart(40,'0'),entry_id:e.id}));
  const beforeLarge=starts;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('context-reader:account-data-merged',{detail:{kinds:['vocabulary']}})));
  for(let i=0;i<100&&starts===beforeLarge;i++)await new Promise(r=>setTimeout(r,30));
  await new Promise(r=>setTimeout(r,2800));
  await study.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'生词本',exact:true}).click();
  await rows.first().waitFor({state:'attached'});
  const countBeforeShuffle=starts, shuffleAt=performance.now();
  await study.getByRole('button',{name:'随机',exact:true}).click();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  report.shuffle2000RowsMs=Math.round(performance.now()-shuffleAt);
  if(await rows.count()>100||await rows.first().getAttribute('aria-setsize')!=='2000'||starts!==countBeforeShuffle)throw Error('Large shuffle lost entries, rendered the whole list or requested a reload');
  await study.getByRole('button',{name:'收藏顺序',exact:true}).click();
  await study.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  await rows.filter({hasText:'word-0001'}).waitFor({timeout:10000});
  await page.setViewportSize({width:390,height:844});
  await study.evaluate(e=>{e.scrollTop=0;});
  await new Promise(r=>setTimeout(r,250));
  const geometry=await rows.evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height};}));
  if(!geometry.some(r=>r.height>120)||geometry.slice(1).some((r,i)=>Math.abs(r.top-geometry[i].bottom)>2))throw Error('Measured vocabulary rows overlap or leave oversized gaps');
  await page.screenshot({path:fileURLToPath(new URL(label+'-vocabulary-large-mobile.png',output))});
  report.measuredLargeRows={mounted:await rows.count(),total:2000,lastReachable:true,mobileVariableHeight:true};
  await study.getByRole('searchbox',{name:'搜索生词'}).fill('word-0001');
  if(await rows.count()!==1||!(await words()).includes('word-0001'))throw Error('Virtual list search lost an unmounted entry');
  await study.getByRole('searchbox',{name:'搜索生词'}).fill('');
  await page.setViewportSize({width:1440,height:960});
  await study.evaluate(e=>{e.scrollTop=0;});
  await rows.first().getByRole('button',{name:/查看 .* 详情/}).focus();
  for(let i=0;i<35;i++)await page.keyboard.press('Tab');
  const focused=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'));
  if(focused!=='查看 word-1965 详情')throw Error('Keyboard traversal stopped at virtual boundary: '+focused);
  await page.keyboard.press('Enter');
  const detail=page.getByRole('dialog',{name:'word-1965',exact:true});
  await detail.waitFor();
  await detail.getByText("中文释义",{exact:true}).waitFor();
  report.summaryDetailResolved=true;
  await page.keyboard.press('Escape');
  await detail.waitFor({state:'hidden'});
  if(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))!==focused)throw Error('Detail close lost the virtual row focus');
  report.measuredLargeRows.keyboardBeyondInitialRange=true;
  report.measuredLargeRows.detailFocusReturn=true;
  holdStart=true;releaseStart=undefined;const cacheReloadAt=Date.now();
  await page.goto((process.env.STUDY_BASE||"http://127.0.0.1:3226")+'/?study=1',{waitUntil:'domcontentloaded'});
  await study.getByRole('navigation',{name:'学习导航'}).getByRole('button',{name:'生词本',exact:true}).click();
  await rows.first().waitFor({state:'attached',timeout:15000});
  if(!releaseStart||await rows.first().getAttribute('aria-setsize')!=='2000')throw Error('Reload did not show the complete cached notebook before the held network response');
  report.cachedReloadBeforeNetworkMs=Date.now()-cacheReloadAt;
  if(await study.getByText('正在连接学习记录…',{exact:true}).count())throw Error('Cache still blocked by the full-screen loader');
  await page.screenshot({path:fileURLToPath(new URL(label+'-cached-reload.png',output))});
  releaseStart();await new Promise(r=>setTimeout(r,200));
 }
 report.errors=errors.slice(errorsBefore);
 await writeFile(new URL(label+'.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
