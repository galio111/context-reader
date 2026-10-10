import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fsrs,createEmptyCard } from "ts-fsrs";
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require("playwright");
const output=new URL("../artifacts/study-ui-browser/",import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:960}});
const page=await context.newPage();
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
 if(p==="/api/auth/session")return json({account});
 if(p==="/api/account/sync")return json({objects:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false});
 if(p==="/api/study"){
  if(route.request().method()==="GET")return json(stamp());
  const b=route.request().postDataJSON();
  if(b.op==="start"){snapshot.today??={day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.map(c=>c.id),new_completed:0,streak:0,settings:{...settings},completed_at:null,reward_points:0};return json(stamp());}
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
try{
 await page.goto(process.env.STUDY_TEST_URL||"http://127.0.0.1:3210/?study=1",{waitUntil:"domcontentloaded",timeout:120000});
 await page.getByRole("button",{name:/模糊/}).waitFor({timeout:60000});
 await check(await page.getByRole("button",{name:"开始今日计划"}).count()===0,"No redundant start gate");
 await shot("desktop-question");await fit();
 await page.getByRole("button",{name:/模糊/}).click();
 await page.getByRole("button",{name:"答对了",exact:true}).waitFor();await shot("desktop-answer");await fit();
 await page.getByRole("button",{name:/查看 flourish 的原文/}).click();
 await page.getByRole("button",{name:"继续背词",exact:true}).waitFor({timeout:30000});
 await page.getByRole("button",{name:"继续背词",exact:true}).click();
 await page.getByRole("button",{name:"下一个",exact:true}).waitFor();
 await check(await page.getByText("已看原文，稍后再练").count()===1,"Assisted recall retained");
 await page.getByRole("button",{name:"下一个",exact:true}).click();
 await page.getByRole("button",{name:"回到上一张",exact:true}).click();
 await page.getByRole("button",{name:/模糊/}).waitFor();
 await check(await page.getByText("Plants ________ in the right conditions.",{exact:true}).count()===1,"Undo restored exact previous card");
 await page.getByRole("button",{name:/模糊/}).click();
 await page.getByRole("button",{name:"答对了",exact:true}).click();
 await check(snapshot.reviews.find(r=>!r.undone)?.answer==="unsure_right","Hard semantic");
 for(const [width,height] of [[1440,900],[390,844],[375,667]]){
  await page.setViewportSize({width,height});
  for(const theme of ["day","night"]){
   await page.evaluate(t=>document.documentElement.dataset.contextTheme=t,theme);
   await page.getByRole("button",{name:"背单词",exact:true}).click();
   await page.getByRole("button",{name:/不记得/}).waitFor();await fit();
   await page.getByRole("button",{name:/不记得/}).click();await fit();await shot(theme+"-"+width+"-answer");
   for(const [label,file] of [["学习数据","stats"],["学习奖励","rewards"],["生词本","words"],["设置","settings"]]){
    await page.getByRole("navigation",{name:"学习导航"}).getByRole("button",{name:label,exact:true}).click();
    await shot(theme+"-"+width+"-"+file);
    const over=await page.locator('dialog[aria-label="背单词"]').evaluate(e=>e.scrollWidth-e.clientWidth);
    await check(over<=1,"Overflow "+file+" "+width+" "+theme);
   }
   await check(await page.getByLabel("每日最多复习",{exact:true}).inputValue()==="100","Review default");
   await check(await page.getByLabel("不记得后，再次出现",{exact:true}).inputValue()==="5","Again default");
   await check(await page.getByLabel("模糊但正确，再次出现",{exact:true}).inputValue()==="10","Hard default");
   await check(await page.getByText("每日新词",{exact:true}).count()===0,"No daily new quota");
   await page.getByRole("button",{name:"暂停",exact:true}).click();
   await page.getByRole("dialog",{name:"暂时停一停？"}).waitFor();
   await shot(theme+"-"+width+"-pause");
   await page.keyboard.press("Escape");
   await check(await page.getByRole("dialog",{name:"背单词",exact:true}).isVisible(),"Nested Escape preserves study");
   await page.getByRole("button",{name:"查看",exact:true}).click();
   await page.getByRole("button",{name:"生成画像 · 5 点"}).click();
   await shot(theme+"-"+width+"-profile-confirm");
   await page.getByRole("button",{name:"取消",exact:true}).click();
   await page.getByRole("button",{name:"背单词",exact:true}).click();
   // Return to question by actually answering, not resetting component state.
   await page.getByRole("button",{name:"下一个",exact:true}).click();
   snapshot.cards.forEach(c=>{c.memory.due=new Date(Date.now()-1000).toISOString();});
   await page.keyboard.press("Escape");
   await page.evaluate(()=>window.dispatchEvent(new Event("context-reader-open-study")));
   await page.getByRole("button",{name:/模糊/}).waitFor();
  }
 }
 snapshot.claims=[{id:"daily:2026-10-10",day:"2026-10-10",milestone:null,points:5,claimed_points:0,plan:null,months:0,earned_at:new Date().toISOString(),claimed_at:null}];
 await page.keyboard.press("Escape");
 await page.evaluate(()=>window.dispatchEvent(new Event("context-reader-open-study")));
 await page.getByRole("dialog",{name:"学习有了新收获"}).waitFor();
 await shot("reward-notice");
 await page.getByRole("button",{name:"稍后领取",exact:true}).click();
 await page.getByRole("button",{name:"学习奖励",exact:true}).click();
 await page.getByRole("button",{name:"领取",exact:true}).click();
 await page.getByRole("button",{name:"已领取",exact:true}).click();
 await check(snapshot.claims[0].claimed_points===5,"Claim applied once");
 await shot("claimed-rewards");
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"暂停",exact:true}).click();
 await page.getByRole("button",{name:"暂停 3 天",exact:true}).click();
 await page.getByRole("button",{name:"恢复学习",exact:true}).waitFor();await shot("paused-state");
 await page.getByRole("button",{name:"恢复学习",exact:true}).click();
 await page.emulateMedia({reducedMotion:"reduce"});
 const animation=await page.locator('article[aria-label="当前复习卡片"]').evaluate(e=>getComputedStyle(e).animationName);
 await check(animation==="none","Reduced motion disables entrance");
 await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"背单词",exact:true}).waitFor({state:"hidden"});
 await check(errors.length===0,"Browser errors: "+errors.join(";"));
 await writeFile(new URL("result.json",output),JSON.stringify({ok:true,evidence,checks:["automatic question","reveal","assisted real Reader round trip","undo exact word","three viewports and both themes","all views","pause and cost dialogs","pending and claimed reward","5/10 minute defaults","100 review default","keyboard","reduced motion"],backend:"mocked HTTP, real application components and FSRS library",quickAnswerGuardTested,errors},null,2));
 console.log("Study UI browser passed");
}catch(error){console.error(await page.locator("body").innerText().catch(()=>""));console.error(error);await shot("failure").catch(()=>{});process.exitCode=1;}
finally{await browser.close();}
