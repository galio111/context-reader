import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fsrs,createEmptyCard } from "ts-fsrs";
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require("playwright");
const output=new URL("../artifacts/study-browser/",import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const owner="9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721";
const base={phonetic:"/ˈflʌrɪʃ/",lemma:"flourish",partOfSpeech:"verb",basicMeaning:"繁荣；茁壮成长",contextMeaning:"茁壮成长",sentenceTranslation:"植物在适当的环境中茁壮成长。",usageNote:"常用于描述生物、事业与文化的发展。",collocation:"flourish in",exampleEnglish:"Creativity can flourish here.",exampleChinese:"创造力可以在这里蓬勃发展。",previousSentence:"",nextSentence:"",difficulty:"medium",shouldAddToVocabulary:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const entries=["flourish","resilient","contemplate"].map((word,i)=>({...base,id:"test-"+i,word,sourceSentence:i===0?"Plants flourish in the right conditions.":"",sourceArticle:i===0?{kind:"public",id:"study-example",title:"A reading example"}:undefined,anki:{cardMode:i===0?"cloze_context":"basic_en_to_cn",clozeSentence:"Plants ________ in the right conditions.",contextCue:"茁壮成长",basicCue:"繁荣",frontPreview:"",backPreview:"",canMakeCloze:i===0}}));
const settings={newPerDay:5,reviewsPerDay:30,retention:.9,pausedUntil:null,reminders:true,includeAnki:false};
let snapshot={serverNow:new Date().toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:e.anki.cardMode,memory:JSON.parse(JSON.stringify(createEmptyCard(new Date()))),version:0,suspended:false,anki_pending:false,created_at:e.createdAt})),entries,today:null,reviews:[],daily:[],streak:{current:0,best:0,last_day:null},rewards:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[{days:2,points:50,plan:null,months:0}],profileEnabled:false,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
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
  if(b.op==="start"){snapshot.today??={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.map(c=>c.id),new_completed:0,streak:0,settings:{...settings},completed_at:null,reward_points:0};return json(stamp());}
  if(b.op==="present")return json({token:randomUUID(),shownAt:new Date().toISOString()});
  if(b.op==="review"){const card=snapshot.cards.find(c=>c.id===b.cardId);const rating=b.answer==="forgot"||b.answer==="unsure_wrong"?1:b.answer==="unsure_right"?2:3;const old=structuredClone(card.memory);const scheduler=fsrs({request_retention:.9,enable_fuzz:false,learning_steps:["1m","10m"],relearning_steps:["10m"]});card.memory=JSON.parse(JSON.stringify(scheduler.next(card.memory,new Date(),rating).card));card.version++;snapshot.reviews.unshift({id:b.id,card_id:card.id,answer:b.answer,rating,reviewed_at:new Date().toISOString(),active_ms:b.activeMs,undone:false,previous:old,next:card.memory});return json({saved:true,id:b.id,snapshot:stamp()});}
  if(b.op==="pause"){snapshot.settings={...snapshot.settings,pausedUntil:new Date(Date.now()+b.days*86400000).toISOString()};return json(stamp());}
  if(b.op==="resume"){snapshot.settings={...snapshot.settings,pausedUntil:null};return json(stamp());}
  if(b.op==="settings"){snapshot.settings=b.settings;return json(stamp());}
  if(b.op==="undo"){const r=snapshot.reviews.find(r=>r.id===b.id),c=snapshot.cards.find(c=>c.id===r.card_id);c.memory=r.previous;c.version++;r.undone=true;return json(stamp());}
  return json(stamp());
 }
 if(p==="/api/study/profile")return json({activeSeconds:900,uniqueLookups:14,eligible:false});
 if(p==="/api/public-articles/study-example")return json({article:{id:"study-example",title:"A reading example",body:"Plants flourish in the right conditions.\n\nA small garden can teach us to look closely at the world.",sourceName:"Study QA",summary:"A small garden",preloadedExplanations:[],preloadedArticleTranslations:[]}});
 if(p==="/api/public-articles")return json({articles:[]});
 if(p==="/api/admin/session")return json({authenticated:false});
 if(p==="/api/connectivity")return json({ok:true});
 if(p==="/api/public-articles/daily-updates")return json({count:0,articles:[]});
 if(p==="/api/pronunciation")return route.fulfill({status:503,contentType:"application/json",body:'{"error":"test pronunciation unavailable"}'});
 return json({});
});
try{
 await page.goto("http://127.0.0.1:3189/?study=1",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"开始今日计划",exact:true}).waitFor({timeout:30000});
 await page.getByRole("button",{name:"开始今日计划",exact:true}).click();
 await page.getByRole("button",{name:"模糊",exact:false}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL("desktop-prompt.png",output)),fullPage:false});
 await page.getByRole("button",{name:"模糊",exact:false}).click();
 await page.getByRole("button",{name:"模糊，但答对了",exact:true}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL("desktop-answer.png",output)),fullPage:false});
 await page.getByRole("button",{name:"查看原文",exact:false}).click();
 await page.getByRole("button",{name:"返回背单词",exact:false}).waitFor();
 await page.getByRole("button",{name:"返回背单词",exact:false}).click();
 await page.getByRole("button",{name:"明白了，稍后再练",exact:true}).waitFor();
 await page.getByRole("button",{name:"明白了，稍后再练",exact:true}).click();
 await page.getByRole("button",{name:"撤销最近一次答题",exact:true}).waitFor();
 await page.getByRole("button",{name:"撤销最近一次答题",exact:true}).click();
 await page.getByRole("button",{name:"模糊",exact:false}).waitFor();
 await page.getByRole("button",{name:"模糊",exact:false}).click();
 await page.getByRole("button",{name:"模糊，但答对了",exact:true}).click();
 await page.getByRole("button",{name:"我的进度",exact:true}).click();
 await page.screenshot({path:fileURLToPath(new URL("desktop-progress.png",output)),fullPage:false});
 await page.getByRole("button",{name:"学习安排",exact:true}).click();
 if(await page.getByRole("combobox").first().inputValue()!=="0.9")throw Error("Default retention control must show the saved 90% value");
 await page.getByRole("button",{name:"申请暂停",exact:true}).click();
 await page.getByRole("button",{name:"确认暂停 3 天",exact:true}).click();
 await page.getByRole("button",{name:"恢复学习",exact:true}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL("desktop-paused.png",output)),fullPage:false});
 await page.getByRole("button",{name:"恢复学习",exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:fileURLToPath(new URL("mobile-prompt.png",output)),fullPage:false});
 await page.getByRole("button",{name:"学习安排",exact:true}).click();
 await page.screenshot({path:fileURLToPath(new URL("mobile-settings.png",output)),fullPage:false});
 const overflow=await page.locator("dialog").evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));
 if(overflow.scroll>overflow.client+1)throw Error("Mobile horizontal overflow: "+JSON.stringify(overflow));
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.keyboard.press("Escape");
 await page.getByRole("dialog").waitFor({state:"hidden"});
 if(errors.length)throw Error("Browser errors: "+errors.join("\n"));
 await writeFile(new URL("result.json",output),JSON.stringify({ok:true,viewportTests:[1440,390],checks:["real component prompt/reveal","uncertain correct","assisted source round trip","undo","pause/resume","mobile overflow","Escape and reduced motion"],backend:"isolated mocked HTTP; FSRS library real",errors},null,2));
 console.log("Study browser smoke passed");
}catch(error){
 console.error(await page.locator("body").innerText().catch(()=>""));
 console.error(error);process.exitCode=1;
}finally{await browser.close();}
