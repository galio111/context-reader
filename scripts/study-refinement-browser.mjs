import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fsrs,createEmptyCard } from "ts-fsrs";
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require("playwright");
const output=new URL("../artifacts/study-refinement-browser/",import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const owner="9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721";
const base={phonetic:"/ˈflʌrɪʃ/",lemma:"flourish",partOfSpeech:"verb",basicMeaning:"繁荣；茁壮成长",contextMeaning:"茁壮成长",sentenceTranslation:"植物在适当的环境中茁壮成长。",usageNote:"常用于描述生物、事业与文化的发展。",collocation:"flourish in",exampleEnglish:"Creativity can flourish here.",exampleChinese:"创造力可以在这里蓬勃发展。",previousSentence:"",nextSentence:"",difficulty:"medium",shouldAddToVocabulary:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const entries=["flourish","resilient","contemplate"].map((word,i)=>({...base,id:"test-"+i,word,sourceSentence:i===0?"Plants flourish in the right conditions.":"",sourceArticle:i===0?{kind:"public",id:"study-example",title:"A reading example"}:undefined,anki:{cardMode:i===0?"cloze_context":"basic_en_to_cn",clozeSentence:"Plants ________ in the right conditions.",contextCue:"茁壮成长",basicCue:"繁荣",frontPreview:"",backPreview:"",canMakeCloze:i===0}}));
const settings={reviewsPerDay:100,forgotMinutes:5,unsureMinutes:10,retention:.9,pausedUntil:null,reminders:true,includeAnki:false};
let snapshot={serverNow:new Date().toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:e.anki.cardMode,memory:JSON.parse(JSON.stringify(createEmptyCard(new Date()))),version:0,suspended:false,anki_pending:false,created_at:e.createdAt})),entries,today:null,reviews:[],daily:[{day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),cards:12,new_cards:5,review_cards:7,reviews:18,successes:15,active_ms:180000}],streak:{current:0,best:0,last_day:null},rewards:[],claims:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[{days:2,points:50,plan:null,months:0}],profileEnabled:true,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
let quickAnswerGuardTested=false;let starts=0;let failSettings=false;let settingsDelay=0;
const stamp=()=>({...snapshot,serverNow:new Date().toISOString()});
const account={configured:true,authenticated:true,profile:{userId:owner,nickname:"学习测试",status:"active",email:"",phone:"",readingInterests:[]},plan:{id:"free",displayName:"免费账号",priceCny:0,active:true,limits:[]},usage:[]};
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 const json=async data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/auth/session")return json({account});
 if(p==="/api/account/sync")return json({objects:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false});
 if(p==="/api/study"){
  if(route.request().method()==="GET")return json(stamp());
  const b=route.request().postDataJSON();
  if(b.op==="start"){starts++;snapshot.today??={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.map(c=>c.id),new_completed:0,streak:0,settings:{...settings},completed_at:null,reward_points:0};return json(stamp());}
  if(b.op==="present")return json({token:randomUUID(),shownAt:new Date().toISOString()});
  if(b.op==="review"&&!quickAnswerGuardTested){quickAnswerGuardTested=true;return route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"请先回忆并核对答案，再记录结果。",code:"too_fast"})});}
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

const check=async(condition,message)=>{if(!condition)throw Error(message);};
const evidence=[];
async function shot(name){await page.locator("dialog[open]").last().evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:fileURLToPath(new URL(name+".png",output)),fullPage:false});}
async function fit(){
 const result=await page.locator('dialog[aria-label="背单词"]').evaluate(el=>({overflow:el.scrollWidth-el.clientWidth,viewport:window.innerHeight,buttons:[...el.querySelectorAll('article[aria-label="当前复习卡片"] footer button,article[aria-label="当前复习卡片"] > div:last-child button')].map(b=>{const r=b.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:b.textContent.trim(),bottom:r.bottom,hit:b===top||b.contains(top)};})}));
 await check(result.overflow<=1,"Horizontal overflow");
 for(const b of result.buttons)await check(b.bottom<result.viewport&&b.hit,"Clipped or intercepted button "+b.label);
 evidence.push(result);
}
try {
 await page.goto("http://127.0.0.1:3211/?study=1",{waitUntil:"domcontentloaded",timeout:120000});
 const study=page.getByRole("dialog",{name:"背单词",exact:true});const nav=study.getByRole("navigation",{name:"学习导航"});
 await study.getByRole("button",{name:"中文提示",exact:true}).waitFor({timeout:60000});
 await check(await study.getByText("茁壮成长",{exact:true}).count()===0,"Chinese hint collapsed");
 await study.getByRole("button",{name:"中文提示",exact:true}).click();await check(await study.getByRole("button",{name:"茁壮成长",exact:true}).isVisible(),"Hint revealed");
 await shot("question");
 await study.getByRole("button",{name:/模糊/}).click();await study.getByRole("button",{name:/查看 flourish 的原文/}).click();
 await page.getByRole("button",{name:"继续背词",exact:true}).waitFor({timeout:30000});await page.getByRole("button",{name:"继续背词",exact:true}).click();
 await study.getByText("已看原文，稍后再练",{exact:true}).waitFor();
 await study.getByRole("button",{name:"下一个",exact:true}).click();await study.getByRole("button",{name:"回到上一张",exact:true}).click();await study.getByRole("button",{name:/模糊/}).waitFor();
 await nav.getByRole("button",{name:"设置",exact:true}).click();
 await check(await study.getByRole("button",{name:"保存安排"}).count()===0,"No save button");
 const retention=study.getByRole("button",{name:"目标记住率",exact:true});await retention.click();await study.getByRole("option",{name:"95%",exact:true}).click();
 await page.waitForFunction(()=>false,{},{timeout:650}).catch(()=>{});await check(snapshot.settings.retention===.95,"Custom select autosaved");
 settingsDelay=600;
 await study.getByLabel("每日最多复习",{exact:true}).fill("125");await study.getByLabel("不记得后，再次出现",{exact:true}).click();
 await new Promise(r=>setTimeout(r,500));await study.getByLabel("不记得后，再次出现",{exact:true}).fill("7");await retention.click();await study.getByRole("option",{name:"90%",exact:true}).click();
 await new Promise(r=>setTimeout(r,1800));await check(snapshot.settings.reviewsPerDay===125&&snapshot.settings.forgotMinutes===7&&snapshot.settings.retention===.9,"Serialized settings retain rapid edits");
 settingsDelay=0;failSettings=true;await study.getByLabel("不记得后，再次出现",{exact:true}).fill("5");await retention.click();await page.keyboard.press("Escape");
 await study.getByRole("status").filter({hasText:"未保存"}).waitFor();await study.getByRole("button",{name:"重试",exact:true}).click();await new Promise(r=>setTimeout(r,200));await check(snapshot.settings.forgotMinutes===5,"Failed save retry");
 await study.getByLabel("每日最多复习",{exact:true}).fill("100");await nav.getByRole("button",{name:"生词本",exact:true}).click();await new Promise(r=>setTimeout(r,650));await check(snapshot.settings.reviewsPerDay===100,"Switching tabs saves edited value");
 await study.getByRole("button",{name:"隐藏英文",exact:true}).click();await check(await study.getByRole("button",{name:"显示英文",exact:true}).count()===4,"Column mask includes all words");
 await study.getByRole("button",{name:"显示英文",exact:true}).nth(1).click();await check(await study.getByRole("button",{name:"flourish",exact:true}).isVisible(),"One word revealed");
 await study.getByRole("button",{name:"隐藏中文",exact:true}).click();await check(await study.getByRole("button",{name:"显示中文",exact:true}).count()===4,"Chinese mask");
 await study.getByRole("button",{name:"查看 flourish 详情",exact:true}).click();
 const detail=page.getByRole("dialog",{name:"flourish",exact:true});await check(await detail.evaluate(e=>e.getBoundingClientRect().width)>700,"Wide detail");
 await context.grantPermissions(["clipboard-read","clipboard-write"]);await detail.getByRole("button",{name:"复制单词释义",exact:true}).click();await check((await page.evaluate(()=>navigator.clipboard.readText())).includes("flourish"),"Actual clipboard text");await shot("word-detail");await detail.getByRole("button",{name:"关闭提示",exact:true}).click();
 await nav.getByRole("button",{name:"学习数据",exact:true}).click();await study.getByRole("button",{name:"一年",exact:true}).click();await check(await study.locator('[aria-label="最近 365 天学习记录"] button').count()===365,"Year history");
 await check(await study.getByText("这些数字如何计算？",{exact:true}).count()===0,"No verbose calculation panel");
 const cells=study.locator('[class*="heatmap"] button');await check(await cells.count()===364,"Calendar day squares");await check(await cells.first().evaluate(e=>Math.abs(e.offsetHeight-e.offsetWidth)<1),"Square geometry");await cells.last().hover();await page.getByRole("tooltip").waitFor();await shot("year-data");
 for(const [width,height] of [[1440,900],[390,844],[375,667]]){
  await page.setViewportSize({width,height});
  for(const theme of ["day","night"]){await page.evaluate(t=>document.documentElement.dataset.contextTheme=t,theme);
   for(const [label,file] of [["学习数据","data"],["生词本","words"],["设置","settings"]]){await nav.getByRole("button",{name:label,exact:true}).click();await shot(theme+"-"+width+"-"+file);await check(await study.evaluate(e=>e.scrollWidth-e.clientWidth)<=1,"No overflow "+label+width);}
   await nav.getByRole("button",{name:"背单词",exact:true}).click();await shot(theme+"-"+width+"-question");await fit();
  }
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.dataset.contextTheme="day");
 await study.getByRole("button",{name:/Menu/}).click();await page.getByRole("button",{name:'账号与用量 02',exact:true}).waitFor();await shot("study-menu");await page.keyboard.press("Escape");await check(await study.isVisible(),"Menu Escape retains study");
 await page.locator("[data-study-menu]").waitFor({state:"hidden"});await page.keyboard.press("Escape");await study.waitFor({state:"hidden"});const began=Date.now();await page.evaluate(()=>window.dispatchEvent(new Event("context-reader-open-study")));await study.getByRole("button",{name:/不记得/}).waitFor();const reopenMs=Date.now()-began;await check(reopenMs<700,"Immediate retained card "+reopenMs);
 await check(await study.locator('[class*="skeleton"]').count()===0,"No repeated skeleton");
 await page.emulateMedia({reducedMotion:"reduce"});await check(await study.locator('article[aria-label="当前复习卡片"]').evaluate(e=>getComputedStyle(e).animationName)==="none","Reduced motion");
 await check(errors.length===0,"Browser errors "+errors.join(";"));
 await writeFile(new URL("result.json",output),JSON.stringify({ok:true,starts,reopenMs,checks:["hint","source roundtrip","undo","autosave sequencing and failure retry","unmount field flush","CET list","English and Chinese individual reveal","wide copy dialog","365-day trend and square calendar","day/night responsive","top-right real Menu","retained card","reduced motion"],evidence,errors,backend:"mocked HTTP with real components"},null,2));console.log("Refinement browser passed",{reopenMs});
}catch(e){console.error(e);console.error((await page.locator('body').innerText()).slice(-5500));await shot("failure").catch(()=>{});process.exitCode=1;}finally{await browser.close();}
