import test from "node:test";
import assert from "node:assert/strict";
import {IDBFactory} from "fake-indexeddb";
import {DEFAULT_STUDY_SETTINGS,newMemory,planProgress,sanitizeStudySettings,studyDayEnd} from "../lib/studyScheduler";
import {studyForecast,remainingStudyCounts,chooseStudyCard} from "../lib/studyPresentation";
import {applyLocalStudyEvent,projectStudyRecord,localStudyDay,type StudyLocalEvent} from "../lib/studyOffline";
import {updateStudyLocalRecord} from "../lib/studyOfflineStore";
import type {StudyCard,StudySnapshot,StudyReview} from "../types/study";
const now=new Date("2026-10-14T01:49:35Z");
const card=(id:string,state=2):StudyCard=>({id,entry_id:id,mode:"basic_en_to_cn",version:0,memory:{...newMemory(now),state,...(state?{stability:5,difficulty:5,reps:3,last_review:"2026-10-10T01:00:00Z"}:{})},suspended:false,anki_pending:false,created_at:now.toISOString()});
function snapshot(cards=[card("old"),card("new",0)]):StudySnapshot{return {offlinePermit:"signed",serverNow:now.toISOString(),settings:DEFAULT_STUDY_SETTINGS,cards,entries:[],today:{day:"2026-10-14",card_ids:cards.map(c=>c.id),new_ids:cards.filter(c=>c.memory.state===0).map(c=>c.id),settings:DEFAULT_STUDY_SETTINGS,reward_points:0,completed_at:null,new_completed:0,streak:0},reviews:[],daily:[],rewards:[],claims:[],streak:{current:0,best:0,last_day:null},policy:{} as StudySnapshot["policy"]};}
function done(id:string,at:number):StudyReview{return {id:"r-"+id,card_id:id,answer:"remembered",rating:3,reviewed_at:new Date(now.getTime()+at).toISOString(),active_ms:1000,undone:false,previous:card(id).memory,next:{...card(id).memory,last_review:new Date(now.getTime()+at).toISOString(),due:"2026-10-16T01:00:00Z"}};}
test("121 due inventory remains intact while the daily plan is capped",()=>{
 const old=Array.from({length:93},(_,i)=>card("r"+i)),learning=Array.from({length:6},(_,i)=>card("l"+i,3));
 const later=Array.from({length:22},(_,i)=>({...card("later"+i),memory:{...card("later"+i).memory,due:"2026-10-14T10:00:00Z"}}));
 const cards=[...old,...learning,...later],ids=[...old,...learning].map(c=>c.id);
 assert.equal(studyForecast(cards,now,true,200)[0].count,121);
 const forecast=studyForecast(cards,now,true,200,0,null,ids);
 assert.equal(forecast[0].count,121);assert.equal(forecast[1].count,0);
 const view=localStudyDay({...snapshot(cards),today:{...snapshot(cards).today!,card_ids:ids}},now);
 const counts=remainingStudyCounts(cards,view.today!.card_ids,now);assert.equal(counts.review+counts.learning,40);
});
test("default order, validation, mixed threshold, due collisions and new-card exclusion",()=>{
 assert.equal(sanitizeStudySettings({}).learningOrder,"review_first");assert.equal(sanitizeStudySettings({}).reviewsPerNew,5);
 for(const p of [{learningOrder:"bad"},{reviewsPerNew:101},{reviewsPerNew:1.5}])assert.throws(()=>sanitizeStudySettings(p));
 const history=Array.from({length:5},(_,i)=>done("r"+i,1000+i*1000));
 const cards=[...history.map(r=>({...card(r.card_id),memory:r.next})),card("waiting",3),card("new",0),card("next",0)];
 const time=new Date(now.getTime()+10000),ids=cards.map(c=>c.id),settings={...DEFAULT_STUDY_SETTINGS,learningOrder:"mixed" as const};
 assert.equal(planProgress(cards,ids,time,[],DEFAULT_STUDY_SETTINGS,history).ready[0].id,"waiting");
 assert.equal(planProgress(cards,ids,time,[],settings,history.slice(1)).ready[0].id,"waiting");
 let p=planProgress(cards,ids,time,[],settings,history);assert.equal(p.ready[0].id,"new");
 assert.equal(chooseStudyCard(p.ready,"","random",new Map([["waiting",0],["new",1],["next",2]]),p.newTurn)?.id,"new");
 assert.equal(chooseStudyCard(p.ready,"waiting","random",new Map(),p.newTurn)?.id,"waiting");
 const introduced={...done("new",11000),previous:card("new",0).memory};
 const after=cards.map(c=>c.id==="new"?{...c,memory:introduced.next}:c);
 p=planProgress(after,ids,new Date(now.getTime()+12000),[],settings,[introduced,...history]);assert.equal(p.newTurn,false);assert.equal(p.blockedNew,1);
 // Undo restores threshold, while the explicit UI pin keeps the undone new card.
 p=planProgress(cards,ids,new Date(now.getTime()+13000),[],settings,[{...introduced,undone:true},...history]);assert.equal(p.newTurn,true);
});
test("durable offline review, repeated learning, undo, midnight and duplicate projection",async()=>{
 const base=snapshot();
 const a:StudyLocalEvent={kind:"review",id:"answer",at:now.toISOString(),permit:"signed",cardId:"old",answer:"forgot",activeMs:1000};
 const first=applyLocalStudyEvent(base,a);assert.equal(first.cards[0].memory.state,3);
 assert.deepEqual(applyLocalStudyEvent(first,a),first);
 const retry:StudyLocalEvent={...a,id:"retry",answer:"remembered",at:first.cards[0].memory.due};
 const second=applyLocalStudyEvent(first,retry);assert.equal(second.cards[0].memory.state,2);
 const undo:StudyLocalEvent={kind:"undo",id:"undo",reviewId:"retry",permit:"signed",at:new Date(Date.parse(retry.at)+1000).toISOString()};
 const restored=applyLocalStudyEvent(second,undo);assert.deepEqual(restored.cards[0].memory,first.cards[0].memory);
 assert.equal(restored.reviews.find(r=>r.id==="retry")?.undone,true);
 const projected=projectStudyRecord({owner:"a",base,events:[a,retry,undo]},new Date(undo.at));assert.equal(projected.daily[0].review_cards,1);assert.equal(projected.claims.length,0);
 assert.equal(localStudyDay(projected,studyDayEnd(now)).today?.day,"2026-10-15");
 const factory=new IDBFactory();await updateStudyLocalRecord("a",()=>({owner:"a",base,events:[a]}),factory);
 await Promise.all([updateStudyLocalRecord("a",r=>({...r!,events:[...r!.events,retry]}),factory),updateStudyLocalRecord("a",r=>({...r!,events:[...r!.events,undo]}),factory)]);
 const reopened=await updateStudyLocalRecord("a",r=>r,factory);assert.equal(reopened?.events.length,3);
 assert.equal(await updateStudyLocalRecord("b",r=>r,factory),null);
 await assert.rejects(updateStudyLocalRecord("a",()=>{throw new Error("simulated failure");},factory));
 assert.equal((await updateStudyLocalRecord("a",r=>r,factory))?.events.length,3);
});

test("offline daily categories match the server: first answer, old learning and undo",()=>{
 const base=snapshot([card("fresh",0),card("prior-learning",1),card("review",2)]);
 const event=(id:string,answer:"forgot"|"remembered"):StudyLocalEvent=>({kind:"review",id:"r-"+id,cardId:id,answer,activeMs:1000,at:now.toISOString(),permit:"signed"});
 const events=[event("fresh","forgot"),event("prior-learning","remembered"),event("review","forgot")];
 const view=projectStudyRecord({owner:"a",base,events},now);
 assert.equal(view.daily[0].new_cards,1);assert.equal(view.daily[0].learning_cards,1);assert.equal(view.daily[0].review_cards,1);
 const undo:StudyLocalEvent={kind:"undo",id:"u",reviewId:"r-fresh",at:now.toISOString(),permit:"signed"};
 const reverted=projectStudyRecord({owner:"a",base,events:[...events,undo]},now);
 assert.equal(reverted.daily[0].new_cards,0);assert.equal(reverted.daily[0].cards,2);
});
