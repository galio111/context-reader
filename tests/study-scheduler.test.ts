import test from "node:test";
import assert from "node:assert/strict";
import { BasicLearningStepsStrategy, fsrs, createEmptyCard, Rating, State, StrategyMode } from "ts-fsrs";
import { buildStudyPlan, DEFAULT_STUDY_SETTINGS, newMemory, planProgress, recallProbability, sanitizeStudySettings, scheduleStudy, shanghaiDay, studyDayEnd, studyRating } from "../lib/studyScheduler";
import type { StudyAnswer, StudyCard } from "../types/study";
import {DEFAULT_STUDY_POLICY,validateStudyPolicy} from "../lib/studyPolicy";

test("uncertain correctness preserves FSRS success/failure semantics without an Easy surrogate",()=>{
 assert.equal(studyRating("forgot"),Rating.Again);
 assert.equal(studyRating("unsure_wrong"),Rating.Again);
 assert.equal(studyRating("unsure_right"),Rating.Hard);
 assert.equal(studyRating("remembered"),Rating.Good);
});
test("a multi-month mixed history agrees with the upstream FSRS implementation at every review",()=>{
 const upstream=fsrs({request_retention:.9,enable_fuzz:false,enable_short_term:true,learning_steps:["5m","10m"],relearning_steps:["5m"],maximum_interval:36500}).useStrategy(StrategyMode.LEARNING_STEPS,(params,state,step)=>{
  const steps=BasicLearningStepsStrategy(params,state,step);steps[Rating.Again]={scheduled_minutes:5,next_step:0};
  if(state!==State.Review)steps[Rating.Hard]={scheduled_minutes:10,next_step:step};return steps;
 });
 let date=new Date("2026-01-01T08:00:00Z"),ours=newMemory(date),reference=createEmptyCard(date);
 const answers:StudyAnswer[]=["forgot","unsure_wrong","unsure_right","remembered"];
 for(let n=0;n<240;n++){
  if(n)date=new Date(reference.due.getTime()+(n%17===0?45*86400000:0));
  const a=n%13===0?answers[n%3]:"remembered";
  const nativeRating=a==="forgot"||a==="unsure_wrong"?Rating.Again:a==="unsure_right"?Rating.Hard:Rating.Good;
  reference=upstream.next(reference,date,nativeRating).card;ours=scheduleStudy(ours,a,date,.9).memory;
  assert.equal(ours.due,reference.due.toISOString());assert.equal(ours.stability,reference.stability);
  assert.equal(ours.difficulty,reference.difficulty);assert.equal(ours.lapses,reference.lapses);
  assert.equal(ours.state,reference.state);
 }
});
test("pause changes retrievability with elapsed time without mutating stability or deleting debt",()=>{
 const start=new Date("2026-01-01T00:00:00Z");
 let m=scheduleStudy(newMemory(start),"remembered",start,.9).memory;
 m=scheduleStudy(m,"remembered",new Date(m.due),.9).memory;
 const before=JSON.stringify(m),early=recallProbability(m,new Date(m.last_review!))!,late=recallProbability(m,new Date("2026-03-01"))!;
 assert.ok(late<early);assert.equal(JSON.stringify(m),before);
 const c:StudyCard={id:"a",entry_id:"e",mode:"cloze_context",memory:m,version:2,suspended:false,anki_pending:false,created_at:start.toISOString()};
 assert.deepEqual(buildStudyPlan([c],{...DEFAULT_STUDY_SETTINGS,pausedUntil:"2026-04-01"},new Date("2026-03-01")),[]);
 assert.deepEqual(buildStudyPlan([c],DEFAULT_STUDY_SETTINGS,new Date("2026-04-02")),["a"]);
});
test("Shanghai midnight, not machine timezone, determines completion and daily plans",()=>{
 const n=new Date("2026-10-05T15:59:59Z");assert.equal(shanghaiDay(n),"2026-10-05");assert.equal(studyDayEnd(n).toISOString(),"2026-10-05T16:00:00.000Z");
 assert.equal(shanghaiDay(new Date(n.getTime()+1000)),"2026-10-06");
});
test("an intraday Good is still learning, not a completed card or reward",()=>{
 const n=new Date("2026-10-05T01:00:00Z"),m=scheduleStudy(newMemory(n),"remembered",n,.9).memory;
 const c:StudyCard={id:"a",entry_id:"e",mode:"basic_en_to_cn",memory:m,version:1,suspended:false,anki_pending:false,created_at:n.toISOString()};
 const progress=planProgress([c],["a"],n);assert.equal(progress.finished,0);assert.equal(progress.waiting.length,1);
 const later=new Date(m.due),next=scheduleStudy(m,"remembered",later,.9).memory;
 assert.equal(planProgress([{...c,memory:next}],["a"],later).finished,1);
});
test("Anki histories are excluded and review limits do not cap user-chosen new words",()=>{
 const n=new Date("2026-10-05"),base:StudyCard={id:"a",entry_id:"e",mode:"basic_en_to_cn",memory:newMemory(n),version:0,suspended:false,anki_pending:true,created_at:n.toISOString()};
 assert.deepEqual(buildStudyPlan([base],DEFAULT_STUDY_SETTINGS,n),[]);
 assert.deepEqual(buildStudyPlan([base],{...DEFAULT_STUDY_SETTINGS,includeAnki:true},n),["a"]);
 const cards=Array.from({length:4},(_,i)=>({...base,id:String(i),anki_pending:false,memory:{...base.memory,state:2}}));
 cards.push({...base,id:"new",anki_pending:false});
 assert.deepEqual(buildStudyPlan(cards,{...DEFAULT_STUDY_SETTINGS,reviewsPerDay:2},n),["0","1","new"]);
});
test("reject backwards review clocks rather than corrupting an existing memory",()=>{
 const m=scheduleStudy(newMemory(new Date("2026-10-05")),"remembered",new Date("2026-10-05"),.9).memory;
 assert.throws(()=>scheduleStudy(m,"remembered",new Date("2026-10-04"),.9));
});
test("unfinished review learning steps block new cards even when no old card is due yet",()=>{
 const now=new Date("2026-10-05T08:00:00Z");
 const fresh:StudyCard={id:"new",entry_id:"e",mode:"cloze_context",memory:newMemory(now),version:0,suspended:false,anki_pending:false,created_at:now.toISOString()};
 const review={...fresh,id:"old",memory:{...newMemory(now),state:3,due:new Date(now.getTime()+600000).toISOString()}};
 const waiting=planProgress([fresh,review],["old","new"],now,["new"]);
 assert.equal(waiting.ready.length,0);assert.equal(waiting.blockedNew,1);assert.equal(waiting.waiting[0].id,"old");
 const done={...review,memory:{...review.memory,state:2,last_review:now.toISOString(),due:new Date(now.getTime()+3*86400000).toISOString()}};
 assert.equal(planProgress([fresh,done],["old","new"],now,["new"]).ready[0].id,"new");
});
test("reward policy preserves approved milestones and rejects malformed financial settings",()=>{
 assert.deepEqual(validateStudyPolicy(DEFAULT_STUDY_POLICY),DEFAULT_STUDY_POLICY);
 assert.equal(DEFAULT_STUDY_POLICY.dailyRewardCap,50);
 assert.deepEqual(DEFAULT_STUDY_POLICY.milestones.map(m=>[m.days,m.points,m.plan,m.months]),[[2,50,null,0],[3,100,null,0],[7,500,null,0],[21,1000,null,0],[30,0,"basic",1],[60,0,"plus",2],[180,0,"plus",6],[365,0,"max",12]]);
 for(const p of [{pointsPerNew:-1},{dailyRewardCap:1e20},{streakMinNew:0},{milestones:[{days:2,points:50,plan:"max",months:0}]},{milestones:[DEFAULT_STUDY_POLICY.milestones[0],DEFAULT_STUDY_POLICY.milestones[0]]}])assert.throws(()=>validateStudyPolicy({...DEFAULT_STUDY_POLICY,...p}));
});
