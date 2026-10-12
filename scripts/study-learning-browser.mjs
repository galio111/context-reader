import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fsrs,createEmptyCard } from "ts-fsrs";
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require("playwright");
const output=new URL("../artifacts/study-learning-browser/",import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();
let cacheFault=false;let savedReads=0;const generatedRequests=[];
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const owner="9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721";
const base={phonetic:"/ˈflʌrɪʃ/",lemma:"flourish",partOfSpeech:"verb",basicMeaning:"繁荣；茁壮成长",contextMeaning:"茁壮成长",sentenceTranslation:"植物在适当的环境中茁壮成长。",usageNote:"常用于描述生物、事业与文化的发展。",collocation:"flourish in",exampleEnglish:"Creativity can flourish here.",exampleChinese:"创造力可以在这里蓬勃发展。",previousSentence:"",nextSentence:"",difficulty:"medium",shouldAddToVocabulary:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const entries=["flourish","resilient","contemplate"].map((word,i)=>({...base,id:"test-"+i,word,sourceSentence:i===0?"Plants flourish in the right conditions.":"",sourceArticle:i===0?{kind:"public",id:"study-example",title:"A reading example"}:undefined,anki:{cardMode:i===0?"cloze_context":"basic_en_to_cn",clozeSentence:"Plants ________ in the right conditions.",contextCue:"茁壮成长",basicCue:"繁荣",frontPreview:"",backPreview:"",canMakeCloze:i===0}}));
const settings={reviewsPerDay:100,forgotMinutes:5,unsureMinutes:10,retention:.9,pausedUntil:null,reminders:true,includeAnki:false};
let snapshot={serverNow:new Date().toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:e.anki.cardMode,memory:JSON.parse(JSON.stringify(createEmptyCard(new Date()))),version:0,suspended:false,anki_pending:false,created_at:e.createdAt})),entries,today:null,reviews:[],daily:[],streak:{current:0,best:0,last_day:null},rewards:[],claims:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[{days:2,points:50,plan:null,months:0}],profileEnabled:true,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
let quickAnswerGuardTested=false;
const stamp=()=>({...snapshot,serverNow:new Date().toISOString()});
const account={configured:true,authenticated:true,profile:{userId:owner,nickname:"学习测试",status:"active",email:"",phone:"",readingInterests:[]},plan:{id:"free",displayName:"免费账号",priceCny:0,active:true,limits:[]},usage:[]};
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 const json=async data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/dictionary-history"){savedReads++;if(cacheFault)return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Saved cache unavailable"})});return json({dictionary:sample});}
 if(/dictionary-stream|explain-word|ask-sentence/.test(p)){generatedRequests.push(p);return route.fulfill({status:503,body:"Generation disabled in QA"});}
 if(p==="/api/auth/session")return json({account});
 if(p==="/api/account/sync")return json({objects:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false});
 if(p==="/api/study"){
  if(route.request().method()==="GET")return json(stamp());
  const b=route.request().postDataJSON();
  if(b.op==="start"){snapshot.today??={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.filter(c=>c.memory.state===0||c.memory.state===1).map(c=>c.id),new_completed:0,streak:0,settings:{...settings},completed_at:null,reward_points:0};return json(stamp());}
  if(b.op==="present")return json({token:randomUUID(),shownAt:new Date().toISOString()});
  if(b.op==="review"&&!quickAnswerGuardTested){quickAnswerGuardTested=true;return route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"请先回忆并核对答案，再记录结果。",code:"too_fast"})});}
  if(b.op==="review"){const card=snapshot.cards.find(c=>c.id===b.cardId);const rating=b.answer==="forgot"||b.answer==="unsure_wrong"?1:b.answer==="unsure_right"?2:3;const old=structuredClone(card.memory);const scheduler=fsrs({request_retention:.9,enable_fuzz:false,learning_steps:["5m","10m"],relearning_steps:["5m"]});card.memory=JSON.parse(JSON.stringify(scheduler.next(card.memory,new Date(),rating).card));card.version++;snapshot.reviews.unshift({id:b.id,card_id:card.id,answer:b.answer,rating,reviewed_at:new Date().toISOString(),active_ms:b.activeMs,undone:false,previous:old,next:card.memory});return json({saved:true,id:b.id,snapshot:stamp()});}
  if(b.op==="claimReward"){const c=snapshot.claims.find(c=>c.id===b.id);const points=c.points-c.claimed_points;c.claimed_points=c.points;c.claimed_at=new Date().toISOString();return json({claimed:{claimed:true,points},snapshot:stamp()});}
  if(b.op==="pause"){snapshot.settings={...snapshot.settings,pausedUntil:new Date(Date.now()+b.days*86400000).toISOString()};return json(stamp());}
  if(b.op==="resume"){snapshot.settings={...snapshot.settings,pausedUntil:null};return json(stamp());}
  if(b.op==="settings"){snapshot.settings=b.settings;return json(stamp());}
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

const check=async(condition,message)=>{if(!condition)throw Error(message);};
const evidence=[];
async function shot(name){await page.locator("dialog[open]").last().evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:fileURLToPath(new URL(name+".png",output)),fullPage:false});}
async function fit(){
 const result=await page.locator('dialog[aria-label="背单词"]').evaluate(el=>({overflow:el.scrollWidth-el.clientWidth,viewport:window.innerHeight,buttons:[...el.querySelectorAll('article[aria-label="当前复习卡片"] footer button,article[aria-label="当前复习卡片"] > div:last-child button')].map(b=>{const r=b.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:b.textContent.trim(),bottom:r.bottom,hit:b===top||b.contains(top)};})}));
 await check(result.overflow<=1,"Horizontal overflow");
 for(const b of result.buttons)await check(b.bottom<result.viewport&&b.hit,"Clipped or intercepted button "+b.label);
 evidence.push(result);
}

snapshot.cards[0].memory.state=1;
snapshot.cards[0].memory.stability=.2;snapshot.cards[0].memory.difficulty=5;snapshot.cards[0].memory.last_review=new Date(Date.now()-600000).toISOString();
snapshot.cards[1].memory.state=2;
snapshot.cards[1].memory.stability=10;
snapshot.cards[1].memory.difficulty=5;snapshot.cards[1].memory.last_review=new Date(Date.now()-86400000).toISOString();
const sample=JSON.parse(await (await import("node:fs/promises")).readFile(process.env.DICTIONARY_SAMPLE,"utf8"));
snapshot.entries[0]={...snapshot.entries[0],word:sample.query,sourceSentence:"",dictionaryResult:undefined};
snapshot.cards[0].mode="basic_en_to_cn";
try{
 await page.goto(process.env.STUDY_TEST_URL||"http://127.0.0.1:3217/?study=1",{waitUntil:"domcontentloaded",timeout:120000});
 const panel=page.getByRole("dialog",{name:"背单词",exact:true});
 await page.getByRole("button",{name:/模糊/}).waitFor({timeout:60000});
 await check((await panel.locator('article[aria-label="当前复习卡片"]').innerText()).includes("正在背"),"Learning label");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.keyboard.press('Space');
  const examples=panel.getByRole('list',{name:'英文例句提示',exact:true});
  await examples.waitFor();
  await check(await examples.locator('li').count()===sample.senses.length,'Every sense has an English example');
  await check(!/[\u4e00-\u9fff]/.test(await examples.innerText()),'No Chinese in dictionary examples');
  const positions=await examples.locator('li').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().top));
  await check(positions.every((y,i)=>!i||y>positions[i-1]),'Examples are vertically stacked');
  await fit();await shot('example-hint-'+width);
  await page.keyboard.press('Space');await check(await examples.count()===0,'Space conceals examples');
 }
 await page.getByRole("button",{name:/不记得/}).click();await page.getByRole("button",{name:"下一个",exact:true}).click();
 await page.getByText("resilient",{exact:true}).waitFor();
 await check((await panel.locator('article[aria-label="当前复习卡片"]').innerText()).includes("复习"),"Review after one learning pass");
 await page.getByRole("button",{name:/不记得/}).click();await page.getByRole("button",{name:"下一个",exact:true}).click();
 await page.getByText("contemplate",{exact:true}).waitFor();
 await check((await panel.locator('article[aria-label="当前复习卡片"]').innerText()).includes("新词"),"New while learning steps wait");
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.getByRole("button",{name:"生词本",exact:true}).click();
  await page.getByRole("button",{name:"隐藏英文",exact:true}).click();
  const row=panel.locator('li').filter({has:page.getByRole('button',{name:`查看 ${sample.query} 详情`,exact:true})});
  await row.getByRole('button',{name:'显示英文',exact:true}).click();
  await check(await row.getByText(sample.query,{exact:true}).isVisible(),"First click reveals");
  await row.getByRole('button',{name:'隐藏英文',exact:true}).click();
  await check(await row.getByText(sample.query,{exact:true}).count()===0,"Second click conceals");
  await row.getByRole('button',{name:'显示英文',exact:true}).focus();await page.keyboard.press('Enter');
  await row.getByRole('button',{name:'隐藏英文',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole("button",{name:"显示英文",exact:true}).first().click();
  await row.getByRole('button',{name:`查看 ${sample.query} 详情`,exact:true}).click();
  const detail=page.getByRole('dialog',{name:sample.query,exact:true});await detail.waitFor();
  await check(await detail.getByText('常见搭配',{exact:true}).isVisible(),"Full dictionary result");
  await check(await detail.getByText(sample.senses[0].exampleEnglish,{exact:true}).isVisible(),"Sense example retained");
  await shot('dictionary-'+width);await page.keyboard.press('Escape');
  await page.getByRole("button",{name:"学习数据",exact:true}).click();
  await panel.getByRole('img',{name:/正在背 2/}).scrollIntoViewIfNeeded();await shot('states-'+width);
  await check(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),"No horizontal overflow");
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole("button",{name:"背单词",exact:true}).click();
 await check(await panel.locator('article[aria-label="当前复习卡片"]').evaluate(e=>getComputedStyle(e).animationName)==='none','Reduced motion');
 // The same saved examples are available for standalone CN-to-EN cards.
 snapshot.cards[2].mode='basic_cn_to_en_dictionary';
 snapshot.entries[2]={...snapshot.entries[2],word:sample.query,sourceSentence:'',anki:{...snapshot.entries[2].anki,basicCue:'配件'}};
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:3217/?study=1',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'英文例句提示',exact:true}).waitFor();
 await page.keyboard.press('Space');await panel.getByRole('list',{name:'英文例句提示',exact:true}).waitFor();
 await page.keyboard.press('Space');await check(await panel.getByRole('list',{name:'英文例句提示',exact:true}).count()===0,'CN-to-EN Space toggles');
 // Contextual word cards retain their original Chinese cloze hint.
 snapshot.cards[2].mode='cloze_context';
 snapshot.entries[2]={...snapshot.entries[2],word:'contemplate',sourceSentence:'She contemplated the proposal.',contextMeaning:'仔细考虑',anki:{...snapshot.entries[2].anki,clozeSentence:'She ________ the proposal.'}};
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:3217/?study=1',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'中文提示',exact:true}).waitFor();
 await page.keyboard.press('Space');await page.getByRole('button',{name:'仔细考虑',exact:true}).waitFor();
 await check(await panel.getByRole('list',{name:'英文例句提示',exact:true}).count()===0,'Context hint unchanged');
 await page.keyboard.press('Space');await page.getByRole('button',{name:'中文提示',exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:960});
 await page.goto(new URL('/',process.env.STUDY_TEST_URL||'http://127.0.0.1:3217').href,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'单独查词',exact:true}).click();
 const input=page.getByRole('combobox');await input.fill(sample.query);await input.press('Enter');
 await page.getByText(sample.senses[0].exampleEnglish,{exact:true}).waitFor();
 await shot('cold-dictionary-cache');
 cacheFault=true;await input.fill('cachefailure');await input.press('Enter');
 await page.getByText('历史结果暂时无法读取，请稍后重试。',{exact:true}).waitFor();
 await check(errors.length===0,JSON.stringify(errors));
 await check(savedReads>0&&generatedRequests.length===0,'Read-only saved dictionary recovery');
 await writeFile(new URL('result.json',output),JSON.stringify({passed:true,errors,savedReads,generatedRequests,checks:['space-examples-all-senses-no-chinese','space-conceals','cn-to-en-space','context-hint-unchanged','typed-query-server-cache','cache-failure-no-generation','learning-review-new','waiting-does-not-block','reveal-hide-keyboard','separate-details','complete-dictionary','four-state-chart','desktop-mobile','reduced-motion']},null,2));
 console.log('PASS learning queue, vocabulary concealment and complete dictionary desktop/mobile');
}finally{await browser.close();}
