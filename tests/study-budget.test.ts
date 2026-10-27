import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStudyPlan,DEFAULT_STUDY_SETTINGS,newMemory,shanghaiDay,studyReviewBudget,budgetSettings} from '../lib/studyScheduler';
import {localStudyDay,projectStudyRecord} from '../lib/studyOffline';
import type {StudyCard,StudyDay,StudyReview,StudySnapshot} from '../types/study';
const now=new Date('2026-10-27T08:00:00Z');
const settings={...DEFAULT_STUDY_SETTINGS};
const cards:StudyCard[]=Array.from({length:320},(_,i)=>({id:String(i).padStart(40,'0'),entry_id:String(i),mode:'basic_en_to_cn',version:1,suspended:false,anki_pending:false,created_at:'2026-09-01T00:00:00Z',memory:{...newMemory(now),state:i<310?2:0,last_review:i<310?'2026-10-01T00:00:00Z':undefined,due:'2026-10-26T00:00:00Z',stability:i+1,difficulty:5,reps:2}}));
const plan=(ids:string[]):StudyDay=>({day:shanghaiDay(now),card_ids:ids,new_ids:cards.filter(c=>c.memory.state===0).map(c=>c.id),settings,reward_points:0,completed_at:null,new_completed:0,streak:0});
const review=(c:StudyCard):StudyReview=>({id:c.id,card_id:c.id,answer:'remembered',rating:3,reviewed_at:now.toISOString(),active_ms:1000,undone:false,previous:c.memory,next:{...c.memory,last_review:now.toISOString(),due:'2026-11-01T00:00:00Z'}});
test('310 due words produce 40 old words plus untouched new words without mutating memories',()=>{
 const before=structuredClone(cards);const ids=buildStudyPlan(cards,settings,now);
 assert.equal(ids.length,50);assert.equal(ids.filter(id=>Number(id)<310).length,40);assert.deepEqual(cards,before);
});
test('all forty finished, reload and settings refresh never backfill the forty-first',()=>{
 const ids=buildStudyPlan(cards,settings,now),history=cards.filter(c=>ids.includes(c.id)&&c.memory.state!==0).map(review);
 const updated=cards.map(c=>({...c,memory:history.find(r=>r.card_id===c.id)?.next??c.memory}));
 assert.deepEqual(buildStudyPlan(updated,settings,now,plan(ids),history),ids);
 assert.equal(buildStudyPlan(updated,{...settings,reviewsPerDay:20},now,plan(ids),history).filter(id=>Number(id)<310).length,40);
 assert.equal(buildStudyPlan(updated,{...settings,reviewExtraDay:shanghaiDay(now),reviewExtraCount:10},now,plan(ids),history).filter(id=>Number(id)<310).length,50);
});
test('legacy unlimited plans are narrowed, completed and undone answers keep their slots',()=>{
 const history=cards.slice(0,15).map(review);history[0].undone=true;
 const ids=buildStudyPlan(cards,settings,now,{...plan(cards.map(c=>c.id)),settings:{...settings,reviewBudgetVersion:undefined}},history);
 assert.equal(ids.filter(id=>Number(id)<310).length,40);for(const r of history)assert.ok(ids.includes(r.card_id));
});
test('learning from prior days costs a slot, today introductions and their retries do not',()=>{
 const c=cards[0],fresh=cards[310];const introduced={...review(fresh),previous:{...fresh.memory,state:0},next:{...fresh.memory,state:1}};
 const list=[{...c,memory:{...c.memory,state:1}},...cards.slice(1,310),{...fresh,memory:introduced.next}];
 const ids=buildStudyPlan(list,{...settings,reviewsPerDay:1},now,null,[introduced]);
 assert.equal(ids.length,2);assert.ok(ids.includes(fresh.id));
});
test('risk priority and oldest-waiting reserve coexist, deterministic across clients',()=>{
 const list=cards.slice(0,20).map((c,i)=>({...c,memory:{...c.memory,stability:i===19?.1:100,due:i===0?'2026-09-01T00:00:00Z':c.memory.due}}));
 const ids=buildStudyPlan(list,{...settings,reviewsPerDay:5},now);
 assert.equal(ids[0],list[0].id);assert.equal(ids[1],list[19].id);
 assert.deepEqual(ids,buildStudyPlan([...list].reverse(),{...settings,reviewsPerDay:5},now));
});
test('Shanghai midnight resets daily extra, legacy settings migrate without changing retention',()=>{
 const s={...settings,reviewExtraDay:'2026-10-27',reviewExtraCount:10};
 assert.equal(studyReviewBudget(s,new Date('2026-10-27T15:59:59Z')),50);
 assert.equal(studyReviewBudget(s,new Date('2026-10-27T16:00:00Z')),40);
 assert.equal(budgetSettings({...settings,reviewsPerDay:200,reviewBudgetVersion:undefined}).reviewsPerDay,40);
 assert.equal(budgetSettings({...settings,retention:.95}).retention,.95);
});
test('offline replay and repeated projection retain the same finite daily plan',()=>{
 const seed={settings,cards,reviews:[],today:null,serverNow:now.toISOString(),daily:[]} as unknown as StudySnapshot;
 const initial=localStudyDay(seed,now),id=initial.today!.card_ids[0];
 const event={id:'00000000-0000-4000-8000-000000000001',at:now.toISOString(),permit:'test',kind:'review' as const,cardId:id,answer:'forgot' as const,activeMs:1000};
 const record={owner:'test',base:initial,events:[event]};const projected=projectStudyRecord(record,now);
 assert.equal(projected.today!.card_ids.filter(id=>Number(id)<310).length,40);
 assert.deepEqual(projectStudyRecord(record,now).today!.card_ids,projected.today!.card_ids);
 assert.deepEqual(localStudyDay(projected,now).today!.card_ids,projected.today!.card_ids);
});
