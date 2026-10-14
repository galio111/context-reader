import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay} from '../lib/studyScheduler.ts';
import {applyLocalStudyEvent} from '../lib/studyOffline.ts';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const output='artifacts/study-spelling-browser';await mkdir(output,{recursive:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const owner='9b8b5a9e-b3ac-4bf9-8cb6-cbe30bfc8721',now=new Date(),settings={...DEFAULT_STUDY_SETTINGS};
const entries=['aspen','look after','forest'].map((word,i)=>({id:'qa-'+i,word,lemma:word,phonetic:'',partOfSpeech:'noun',basicMeaning:'白杨；山杨',contextMeaning:'白杨',sourceSentence:i===1?'They look after the trees.':'Recent reintroduction efforts in Idaho have been connected to healthier trout populations and increased '+word+' growth.',sentenceTranslation:'爱达荷州近期的重新引入行动与更健康的鳟鱼种群和白杨生长增加有关。',usageNote:'aspen 指一种树皮灰白、叶子会颤动的落叶树，常出现在北美生态、林业和野生动物栖息地话题中。',collocation:'aspen grove（白杨林）；aspen tree（白杨树）；aspen growth（白杨生长）',exampleEnglish:'The beavers helped restore the aspen grove near the river.',exampleChinese:'海狸帮助恢复了河边的白杨林。',previousSentence:'',nextSentence:'',difficulty:'medium',shouldAddToVocabulary:true,createdAt:now.toISOString(),updatedAt:now.toISOString(),anki:{cardMode:'cloze_context',clozeSentence:'The ________ grows.',basicCue:'白杨',canMakeCloze:true}}));
let snapshot={offlinePermit:'qa-permit',serverNow:now.toISOString(),settings,cards:entries.map((e,i)=>({id:String(i+1).repeat(40),entry_id:e.id,mode:'cloze_context',memory:{...newMemory(now),state:i<6?2:0,...(i<6?{stability:5,difficulty:5,reps:3,last_review:new Date(now.getTime()-86400000).toISOString()}:{}),due:new Date(now.getTime()-1000).toISOString()},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()})),entries,today:null,reviews:[],daily:[],streak:{current:0,best:0,last_day:null},rewards:[],claims:[],policy:{rewardsEnabled:true,pointsPerNew:1,dailyRewardCap:50,rewardDays:90,streakMinNew:5,milestones:[],profileEnabled:false,profileCost:5,minimumReadingMinutes:60,minimumLookups:50}};
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
const input=()=>dialog.getByRole('textbox',{name:'拼写单词或短语'});
const shot=async name=>page.screenshot({path:output+'/'+name+'.png'});
const go=async()=>{await page.goto(process.env.STUDY_TEST_URL||'http://127.0.0.1:3224/?study=1',{waitUntil:'domcontentloaded',timeout:90000});await input().waitFor({timeout:60000});};
try{
 await go();
 await page.keyboard.type('aspan');assert.equal(await input().inputValue(),'aspan');assert.equal(await input().evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 const before=await input().boundingBox();await input().fill('a'.repeat(256));const after=await input().boundingBox();assert.equal(before.width,after.width);assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await shot('long-input');
 await input().fill('aspan');await shot('desktop-prompt');
 await dialog.getByRole('button',{name:/^记得$/}).click();
 const answer=dialog.getByLabel('核对答案');await answer.locator('del').waitFor();assert.equal(await answer.locator('del').textContent(),'a');assert.equal(await answer.locator('ins').textContent(),'e');
 assert.equal(await answer.locator('details').count(),0);assert.equal(await answer.getByText('常见搭配',{exact:true}).count(),1);assert.equal(await answer.getByText('新例句',{exact:true}).count(),1);await shot('desktop-correction');await answer.evaluate(el=>el.scrollTop=el.scrollHeight);await shot('desktop-detail-bottom');await answer.evaluate(el=>el.scrollTop=0);
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await shot('mobile-correction');assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.evaluate(()=>document.documentElement.setAttribute('data-context-theme','night'));await shot('night-correction');await page.evaluate(()=>document.documentElement.removeAttribute('data-context-theme'));
 await dialog.getByRole('button',{name:'答错了',exact:true}).click();await input().waitFor();await input().fill('lookafter');await dialog.getByRole('button',{name:/模糊/}).click();await answer.locator('ins').waitFor();assert.equal(await answer.locator('ins').getAttribute('data-missing'),'true');assert.equal(await answer.locator('ins').textContent(),'␣');await shot('missing-space');
 await dialog.getByRole('button',{name:'答错了',exact:true}).click();await input().waitFor();await input().fill('forest');await dialog.getByRole('button',{name:/不记得/}).click();await answer.getByText('拼写正确',{exact:true}).waitFor();await shot('correct');
 assert.equal(await answer.locator('del,ins').count(),0);
 await dialog.getByRole('button',{name:'生词本',exact:true}).click();await dialog.getByRole('button',{name:'查看 aspen 详情'}).click();
 const detail=page.getByRole('dialog',{name:'aspen',exact:true});await detail.getByText('新例句',{exact:true}).waitFor();assert.equal(await detail.locator('details').count(),0);assert.equal(await detail.locator('p[lang=en]').filter({hasText:'Recent reintroduction'}).count(),1);
 await shot('notebook-detail');await detail.getByRole('button',{name:'关闭提示'}).click();assert.deepEqual(errors,[]);
 await writeFile(output+'/result.json',JSON.stringify({checks:['direct typing','bounded long input','remembered substitution','unsure missing space','forgot exact spelling','always expanded details','desktop/mobile/night/reduced motion','unchanged answer submission'],errors},null,2));console.log('Spelling browser checks passed');
}finally{await browser.close();}
