import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStudyPlan,DEFAULT_STUDY_SETTINGS,newMemory,planProgress,studyReady} from '../lib/studyScheduler';
import {studyForecast} from '../lib/studyPresentation';
import type {StudyCard} from '../types/study';
const now=new Date('2026-10-17T00:00:00+08:00');
const make=(id:string,due:string,state=2):StudyCard=>({id,entry_id:id,mode:'basic_en_to_cn',memory:{...newMemory(now),state,due},version:7,suspended:false,anki_pending:false,created_at:now.toISOString()});
test('193 = 96 carried + 97 due, including 37 evening reviews; midnight excludes next day',()=>{
 const cards=[...Array.from({length:96},(_,i)=>make('old'+i,'2026-10-16T22:00:00+08:00')),...Array.from({length:97},(_,i)=>make('due'+i,'2026-10-17T22:24:00+08:00')),make('next','2026-10-18T00:00:00+08:00')];
 const before=structuredClone(cards), yesterday=new Date('2026-10-16T23:59:59+08:00');
 const prev=studyForecast(cards,yesterday,false,1), today=studyForecast(cards,now,false,1);
 assert.equal(prev[0].count+prev[1].count,today[0].count);assert.equal(today[0].count,193);
 const ids=buildStudyPlan(cards,{...DEFAULT_STUDY_SETTINGS,reviewsPerDay:1},now);
 assert.equal(ids.length,1);assert.equal(planProgress(cards,ids,now).ready.length,1);
 assert.equal(today[1].count,1);assert.deepEqual(cards,before);
});
test('short steps keep exact waiting; tomorrow review cannot be presented today',()=>{
 for(const state of [1,3])assert.equal(studyReady(make('step','2026-10-17T00:15:00+08:00',state).memory,now),false);
 assert.equal(studyReady(make('review','2026-10-17T23:59:59+08:00').memory,now),true);
 assert.equal(studyReady(make('tomorrow','2026-10-18T00:00:00+08:00').memory,now),false);
});
