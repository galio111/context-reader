import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STUDY_SETTINGS, buildStudyPlan, newMemory, scheduleStudy, sanitizeStudySettings } from "../lib/studyScheduler";
import { activeStudySnapshot, chooseStudyCard, studyForecast, studyHistoryDays } from "../lib/studyPresentation";
import { fsrs, Rating } from "ts-fsrs";
import type { StudyCard, StudySnapshot } from "../types/study";
const now=new Date("2026-10-10T02:00:00Z");
const card=(id:string,state=0):StudyCard=>({id,entry_id:id,mode:"basic_en_to_cn",memory:{...newMemory(now),state},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()});
test("new words have no 5/50 ceiling and reviews default to 100",()=>{
 assert.equal(DEFAULT_STUDY_SETTINGS.reviewsPerDay,100);
 const cards=Array.from({length:600},(_,i)=>card(String(i),i<160?2:0));
 const ids=buildStudyPlan(cards,DEFAULT_STUDY_SETTINGS,now);
 assert.equal(ids.length,540);assert.equal(ids.filter(id=>Number(id)<160).length,100);
});
test("five and ten minute steps preserve upstream FSRS memory and long-term Hard",()=>{
 const original=newMemory(now),again=scheduleStudy(original,"forgot",now,.9),hard=scheduleStudy(original,"unsure_right",now,.9);
 assert.equal(Date.parse(again.memory.due)-now.getTime(),300000);
 assert.equal(Date.parse(hard.memory.due)-now.getTime(),600000);
 const upstream=fsrs({request_retention:.9,enable_fuzz:false,enable_short_term:true,learning_steps:["5m","10m"],relearning_steps:["5m"]});
 const expected=upstream.next(original,now,Rating.Hard).card;
 assert.equal(hard.memory.difficulty,expected.difficulty);assert.equal(hard.memory.stability,expected.stability);
 let m=scheduleStudy(original,"remembered",now,.9).memory;
 m=scheduleStudy(m,"remembered",new Date(m.due),.9).memory;
 const date=new Date(m.due),reference=upstream.next(m,date,Rating.Hard).card;
 assert.equal(scheduleStudy(m,"unsure_right",date,.9).memory.due,reference.due.toISOString());
 assert.equal(Date.parse(scheduleStudy(m,"forgot",date,.9,{forgotMinutes:7}).memory.due)-date.getTime(),420000);
 for(const bad of [NaN,-1,121,2.5])assert.throws(()=>sanitizeStudySettings({forgotMinutes:bad}));
});
test("shuffle never crosses review-first boundary or replaces the visible question",()=>{
 const old=card("old",1),fresh=card("new"),other=card("other",2),rank=new Map([["new",0],["old",.4],["other",.9]]);
 assert.equal(chooseStudyCard([old,other,fresh],"","random",rank)?.id,"old");
 assert.equal(chooseStudyCard([old,other,fresh],"other","random",rank)?.id,"other");
});
test("Anki exclusions apply equally to vocabulary and progress without erasing source data",()=>{
 const a=card("a"),b={...card("b"),anki_pending:true};
 const snapshot={settings:DEFAULT_STUDY_SETTINGS,cards:[a,b],entries:[{id:"a"},{id:"b"}]} as StudySnapshot;
 const active=activeStudySnapshot(snapshot);
 assert.deepEqual(active.cards.map(c=>c.id),["a"]);assert.deepEqual(active.entries.map(c=>c.id),["a"]);assert.equal(snapshot.cards.length,2);
});
test("history fills missing days with zero and forecasts use Shanghai dates",()=>{
 const days=studyHistoryDays([{day:"2026-10-09",cards:3,active_ms:30000,successes:2,reviews:4}],"2026-10-10",3);
 assert.deepEqual(days.map(d=>d.cards),[0,3,0]);
 const c=card("a",2);c.memory.due="2026-10-10T16:01:00Z";
 assert.equal(studyForecast([c],now,false)[0].count,1);
 assert.equal(studyForecast([{...c,anki_pending:true}],now,false)[0].count,0);
});
