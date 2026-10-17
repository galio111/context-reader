import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay,studyDayEnd} from '../lib/studyScheduler.ts';
import {applyLocalStudyEvent} from '../lib/studyOffline.ts';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const output='artifacts/study-day-browser';await mkdir(output,{recursive:true});
await page.addInitScript(()=>{
 window.studyFrameAudit={frames:0,leaks:[],authorized:[]};
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('button');
  if(button&&/^(?:[123]\s*)?(不记得|模糊|记得)$/.test(button.textContent.trim())){
   const key=document.querySelector('[data-card-key]')?.getAttribute('data-card-key');
   window.studyFrameAudit.authorized.push(key);
  }
 },true);
 const frame=()=>{const card=document.querySelector('[data-card-key]');if(card){window.studyFrameAudit.frames++;if(card.dataset.answer==='true'&&!window.studyFrameAudit.authorized.includes(card.dataset.cardKey))window.studyFrameAudit.leaks.push(card.dataset.cardKey);}requestAnimationFrame(frame);};requestAnimationFrame(frame);
});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const owner='9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721',now=new Date(),settings={...DEFAULT_STUDY_SETTINGS};
const entries=['alpha','bravo','charlie','delta','echo','foxtrot','freshword','newword'].map((word,i)=>({id:'qa-'+i,word,lemma:word,phonetic:'',partOfSpeech:'noun',basicMeaning:'测试释义',contextMeaning:'测试释义',sourceSentence:'',sentenceTranslation:'',usageNote:'',collocation:'',exampleEnglish:'',exampleChinese:'',previousSentence:'',nextSentence:'',difficulty:'medium',shouldAddToVocabulary:true,createdAt:now.toISOString(),updatedAt:now.toISOString(),anki:{cardMode:'basic_en_to_cn',basicCue:'测试释义',canMakeCloze:false}}));
let snapshot={offlinePermit:'qa-permit',serverNow:now.toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:'basic_en_to_cn',memory:{...newMemory(now),state:i<6?2:0,...(i<6?{stability:5,difficulty:5,reps:3,last_review:new Date(now.getTime()-86400000).toISOString()}:{}),due:i<6?new Date(studyDayEnd(now).getTime()-1000).toISOString():now.toISOString()},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()})),entries,today:null,reviews:[],daily:[],streak:{current:0,best:0,last_day:null},rewards:[],claims:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[],profileEnabled:false,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
snapshot.today={day:shanghaiDay(now),card_ids:snapshot.cards.map(c=>c.id),new_ids:snapshot.cards.slice(6).map(c=>c.id),settings,new_completed:0,streak:0,completed_at:null,reward_points:0};
const account={configured:true,authenticated:true,profile:{userId:owner,nickname:'离线验收',status:'active',email:'',phone:'',readingInterests:[]},plan:{id:'free',displayName:'免费账号',priceCny:0,active:true,limits:[]},usage:[]};
let disconnected=false;const received=new Set();
await page.route('**/api/**',async route=>{
 const p=new URL(route.request().url()).pathname,json=d=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});
 if(disconnected&&['/api/study','/api/auth/session','/api/account/sync'].includes(p))return route.abort('internetdisconnected');
 if(p==='/api/auth/session')return json({account});
 if(p==='/api/account/sync')return json({objects:[],nextOffset:null,snapshotCursor:'',nextCursor:'',hasMore:false});
 if(p==='/api/study'){
  const b=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(b.op==='local_event'){
   const e=b.event;if(!received.has(e.id)){snapshot=applyLocalStudyEvent(snapshot,e);received.add(e.id);}
   const r=snapshot.reviews.find(r=>r.id===(e.kind==='undo'?e.reviewId:e.id));
   return json({ack:{id:e.id,serverNow:new Date().toISOString(),outcome:{saved:true},review:r,card:snapshot.cards.find(c=>c.id===r?.card_id),settings:e.kind==='settings'?snapshot.settings:undefined,today:snapshot.today}});
  }
  return json({...snapshot,serverNow:new Date().toISOString()});
 }
 if(p==='/api/public-articles')return json({articles:[]});if(p==='/api/admin/session')return json({authenticated:false});if(p==='/api/connectivity')return json({ok:true});return json({});
});
const dialog=page.getByRole('dialog',{name:'背单词',exact:true});
const pending=()=>page.evaluate(async owner=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('context-reader-study-offline',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const r=await new Promise(resolve=>{const q=db.transaction('sessions').objectStore('sessions').get(owner);q.onsuccess=()=>resolve(q.result);});db.close();return r?.events.length??-1;},owner);
async function waitUntil(fn){for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100);}throw Error('condition timeout');}
async function answer(){const bounds=await dialog.locator('[data-card-key]').boundingBox();await dialog.getByRole('button',{name:/^3\s*记得$/}).click();const revealed=await dialog.locator('[data-card-key]').boundingBox();assert.equal(revealed.height,bounds.height,'revealing must not resize the card shell');await dialog.getByRole('button',{name:'答对了',exact:true}).click();await waitUntil(async()=>await dialog.getByRole('button',{name:/^3\s*记得$/}).count()>0);}
try{
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:3219/?study=1',{waitUntil:'domcontentloaded'});
 await dialog.getByText('alpha',{exact:true}).waitFor({timeout:60000});
 await dialog.getByRole('button',{name:'学习数据',exact:true}).click();
 assert.ok(await dialog.getByText(/今天待复习 6 个词/).count());
 await page.screenshot({path:output+'/daily-counts.png'});
 await dialog.getByRole('button',{name:'设置',exact:true}).click();
 assert.equal(await dialog.getByRole('button',{name:'学习顺序',exact:true}).textContent(),'先复习，再学新词⌄');
 await dialog.getByRole('button',{name:'学习顺序',exact:true}).click();await page.getByRole('option',{name:'复习时穿插新词'}).click();
 const input=dialog.getByRole('spinbutton',{name:'每复习多少词，学 1 个新词'});assert.equal(await input.inputValue(),'5');await input.fill('2');await input.press('Enter');
 await waitUntil(()=>snapshot.settings.reviewsPerNew===2);await page.screenshot({path:output+'/desktop-settings.png'});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:output+'/mobile-settings.png'});
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.setViewportSize({width:1440,height:1000});await dialog.getByRole('button',{name:'继续背词',exact:true}).click();
 disconnected=true;await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
 await answer();await dialog.getByText('bravo',{exact:true}).waitFor();await answer();await dialog.getByText('freshword',{exact:true}).waitFor();
 assert.equal(await dialog.getByText(/网络未连接|当前离线|正在核对最新进度/).count(),0);
 await dialog.getByRole('button',{name:'回到上一张'}).click();await dialog.getByText('bravo',{exact:true}).waitFor();await page.waitForTimeout(1300);await dialog.getByText('bravo',{exact:true}).waitFor();
 await page.screenshot({path:output+'/offline-undo.png'});assert.ok(await pending()>=3);
 const frameAudit=await page.evaluate(()=>window.studyFrameAudit);assert.ok(frameAudit.frames>0);assert.deepEqual(frameAudit.leaks,[]);await writeFile(output+'/frames.json',JSON.stringify(frameAudit,null,2));
 disconnected=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await waitUntil(async()=>await pending()===0);
 await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:3219/?study=1',{waitUntil:'domcontentloaded'});await dialog.getByRole('button',{name:/^3\s*记得$/}).waitFor();
 await dialog.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await dialog.getByRole('spinbutton',{name:'每复习多少词，学 1 个新词'}).inputValue(),'2');
 assert.deepEqual(errors,[]);await writeFile(output+'/result.json',JSON.stringify({checks:['default review-first','mixed default 5, configurable 2','desktop and 390px reduced motion','offline 2 old words then new','undo remains pinned','reconnect drains journal','reload retains settings'],received:received.size,errors},null,2));
 console.log('Study daily due, evening review and offline checks passed');
}catch(error){await page.screenshot({path:output+'/failure.png'});await writeFile(output+'/failure.txt',JSON.stringify({errors,text:await page.locator('body').innerText()},null,2));throw error;}finally{await browser.close();}
