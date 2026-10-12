import {createRequire} from "node:module";
import {mkdir,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url)("playwright");
const base=process.env.UX_BASE||"http://127.0.0.1:3213",out=process.env.UX_OUTPUT||"artifacts/ux-detail-browser";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[],evidence=[];
page.on("pageerror",e=>errors.push(e.message));
const owner="11111111-1111-4111-8111-111111111111";
const account={configured:true,authenticated:true,profile:{userId:owner,nickname:"界面验收",status:"active",email:"",phone:"13800000000",readingInterests:[]},plan:{id:"free",displayName:"免费账号",priceCny:0,active:true,limits:[]},usage:[]};
const snapshot={serverNow:new Date().toISOString(),settings:{reviewsPerDay:100,retention:.9,forgotMinutes:5,unsureMinutes:10,pausedUntil:null,includeAnki:false,reminders:false},cards:[],entries:[],reviews:[],daily:[],today:null,streak:{current:0,best:0,last_day:null},claims:[],rewards:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[],profileEnabled:true,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
const plans=["free","basic","plus","max"].map((id,i)=>({id,name:id,monthlyFen:i*1200,annualFen:i*12000,points:i?1200*i:50,active:true}));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname,json=data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/auth/session")return json({account});
 if(p==="/api/account/sync")return json({objects:[],results:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false,protocol:2});
 if(p==="/api/account/activity")return json({seconds:128,todaySeconds:45,readingDays:2,since:new Date().toISOString()});
 if(p==="/api/study")return json(snapshot);
 if(p==="/api/study/profile")return json({activeSeconds:128,uniqueLookups:5,eligible:false});
 if(p==="/api/billing"){await new Promise(r=>setTimeout(r,300));return json({plans,paymentReady:false});}
 if(p==="/api/public-articles")return json({articles:[]});
 if(p==="/api/admin/session")return json({authenticated:false});
 if(p==="/api/pronunciation")return route.fulfill({status:503,body:'{"error":"test audio"}'});
 if(p==="/api/cet"){await new Promise(r=>setTimeout(r,800));return json({papers:[],total:0,hasMore:false});}
 return json({ok:true,count:0,articles:[]});
});
const shot=async name=>{await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:out+"/"+name+".png",fullPage:false});};
try{
 await page.goto(base,{waitUntil:"domcontentloaded",timeout:120000});
 const workbench=page.getByRole("region",{name:"阅读工作台"});
 await workbench.getByRole("textbox").waitFor({timeout:60000});
 const positions=await workbench.evaluate(el=>{const entry=el.querySelector('[class*="entry"]'),header=el.querySelector("h1");return {study:entry?.getBoundingClientRect().y,import:header?.getBoundingClientRect().y,overflow:document.documentElement.scrollWidth-innerWidth};});
 assert.ok(positions.study<positions.import);assert.ok(positions.overflow<=1);evidence.push({home:positions});
 await page.locator('[class*="_memberOpening__"]').waitFor({state:"hidden",timeout:20000});await shot("home-desktop");
 await workbench.getByRole("textbox").fill("This One-of-a-Kind Bronze Ring Offers a Tantalizing Glimpse at the Lighthouse of Alexandria, a Lost Wonder of the Ancient World.\n\nThe resilient team worked together and found a fascinating new source of information.");
 await workbench.getByRole("button",{name:"开始阅读",exact:true}).click();
 const rail=page.getByRole("complementary",{name:"阅读快捷入口"});
 await rail.getByRole("button",{name:/查词/}).waitFor({timeout:60000});
 const dictionary=page.locator('aside[class*="dictionaryWindow"]');
 const importer=page.getByRole("dialog",{name:"导入新文章",exact:true});
 await rail.getByRole("button",{name:/查词/}).click();await dictionary.waitFor();
 await rail.getByRole("button",{name:/导入/}).click();await importer.waitFor();
 const stack=async()=>page.evaluate(()=>{const d=document.querySelector('aside[class*="dictionaryWindow"]'),i=document.querySelector('[class*="workLayerBackdrop"]');return {dictionary:Number(getComputedStyle(d).zIndex),import:Number(getComputedStyle(i).zIndex)};});
 let order=await stack();assert.ok(order.import>order.dictionary);await shot("import-over-dictionary");
 await rail.getByRole("button",{name:/查词/}).click();order=await stack();assert.ok(order.dictionary>order.import);
 await rail.getByRole("button",{name:/导入/}).click();order=await stack();assert.ok(order.import>order.dictionary);
 await page.keyboard.press("Escape");await importer.waitFor({state:"hidden"});assert.ok(await dictionary.isVisible());
 await dictionary.getByRole("button",{name:"隐藏单独查词窗口"}).click();await dictionary.waitFor({state:"hidden"});
 await rail.getByRole("button",{name:/导入/}).click();await importer.waitFor();
 await rail.getByRole("button",{name:/查词/}).click();await dictionary.waitFor();order=await stack();assert.ok(order.dictionary>order.import);await shot("dictionary-over-import");
 await page.keyboard.press("Escape");await dictionary.waitFor({state:"hidden"});assert.ok(await importer.isVisible());await page.keyboard.press("Escape");await importer.waitFor({state:"hidden"});
 evidence.push({toolOpeningOrders:true,escapeRestoresPrevious:true});
 page.once("dialog",dialog=>dialog.dismiss());
 await rail.getByRole("button",{name:"返回首页",exact:true}).click();await workbench.waitFor();
 await page.locator('[class*="_memberOpening__"]').waitFor({state:"hidden",timeout:20000});await shot("home-long-title");
 // Real developer guard resolves through the loopback-only test backend, not a client bypass.
 await page.goto(base+"/admin/experience",{waitUntil:"domcontentloaded",timeout:120000});
 const frame=page.frameLocator('iframe[title="用户界面预览"]');
 await page.waitForFunction(()=>!!document.querySelector("iframe")?.contentWindow?.__contextPreviewStorage,{},{timeout:60000});
 await page.getByLabel("预览界面").selectOption("account");
 await page.waitForFunction(()=>document.querySelector("iframe").src.includes("screen=account"));
 for(const plan of ["guest","free","basic","plus","max"]){
  await page.getByLabel("预览身份").selectOption(plan);
  for(const balance of ["available","low","empty"]){
   await page.getByLabel("预览额度").selectOption(balance);
   await frame.getByRole("heading",{name:"账号与用量",exact:true}).waitFor({timeout:60000});
   await frame.getByRole("heading",{name:plan==="guest"?"当前为游客":"体验账号",exact:true}).waitFor();
   const info=await page.locator("iframe").evaluate(async el=>{const w=el.contentWindow;return {fake:(await (await w.fetch("/api/auth/session")).json()).account,isolated:!!w.__contextPreviewStorage,overflow:w.document.documentElement.scrollWidth-w.innerWidth};});
   assert.equal(info.fake.plan.id,plan);assert.ok(info.isolated);assert.ok(info.overflow<=1);
   if(balance==="empty")assert.ok(info.fake.usage.every(u=>u.remaining===0));
   evidence.push({plan,balance,isolated:info.isolated});
  }
 }
 await page.getByLabel("预览身份").selectOption("basic");await frame.getByRole("heading",{name:"体验账号",exact:true}).waitFor();await shot("preview-basic-exhausted");
 await frame.getByRole("button",{name:/阅读画像/}).click();await frame.getByRole("heading",{name:"从真实阅读开始"}).waitFor();await page.keyboard.press("Escape");
 await page.getByLabel("预览界面").selectOption("home");await frame.getByRole("region",{name:"阅读工作台"}).waitFor();
 await frame.getByRole("button",{name:"单独查词",exact:true}).click();await frame.getByRole("combobox").fill("militia");
 await frame.getByRole("button",{name:"深度查询",exact:true}).click();await frame.getByText(/学习点数额度已用完/).first().waitFor();
 evidence.push({exhaustedDictionary:true});
 await page.getByLabel("预览界面").selectOption("account");
 await page.getByLabel("预览屏幕").selectOption("mobile");await page.getByLabel("预览身份").selectOption("free");await frame.getByRole("heading",{name:"体验账号",exact:true}).waitFor();await shot("preview-mobile-account");
 await page.getByLabel("预览界面").selectOption("home");await frame.getByRole("region",{name:"阅读工作台"}).waitFor();await shot("preview-mobile-home");
 await page.getByLabel("预览界面").selectOption("billing");await frame.getByRole("heading",{name:"找到适合你的阅读节奏。",exact:true}).waitFor();await shot("preview-mobile-billing");
 assert.deepEqual(errors,[]);await writeFile(out+"/result.json",JSON.stringify({passed:true,evidence,errors},null,2));console.log("UX browser passed",evidence.length);
}catch(e){await shot("failure");await writeFile(out+"/failure.txt",await page.locator("body").innerText());console.error(e);console.error({errors,frames:page.frames().map(f=>f.url())});console.error((await page.locator("body").innerText()).slice(-1500));process.exitCode=1;}
finally{await browser.close();}

