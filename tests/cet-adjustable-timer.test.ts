import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createCetActivity,cetAnswer,cetElapsedMs,cetRemainingMs,cetPause,cetResume,cetFinalize,mergeCetActivity} from '../lib/cetActivity';
import {adjustCetTimer,projectCetTimer,type CetTimerTarget} from '../lib/cetAdjustableTimer';
import {saveCetActivity,readCetActivities,CET_ACTIVITIES_V3_KEY,normalizeCetActivity} from '../lib/cetActivityStorage';import type {CetActivity,CetPaper} from '../types/cet';
const paper=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-12-1.json',import.meta.url),'utf8')) as CetPaper;
const at=(seconds:number)=>new Date(Date.parse('2026-09-25T00:00:00Z')+seconds*1000).toISOString();
const target=(a:CetActivity):CetTimerTarget=>({owner:a.owner,activityId:a.id,sectionId:a.activeSection,revision:a.timerRevision});
test('90 second countup reset then 30 retains 120 cumulative, same answers and immutable final',()=>{
 let a=createCetActivity({paper,purpose:'self_test',owner:'A',timerMode:'countup',now:at(0)});a=cetAnswer(a,a.questionKeys[0],'A',at(1),'answer');
 a=adjustCetTimer(a,target(a),'reset',undefined,at(90),'reset');assert.equal(a.schemaVersion,4);assert.ok(normalizeCetActivity(a));
 assert.equal(projectCetTimer(a,a.activeSection,Date.parse(at(120))).display,30000);assert.equal(cetElapsedMs(a,Date.parse(at(120))),120000);
 const done=cetFinalize(a,paper,'manual_submit',undefined,at(120),'final');assert.equal(done.finalizations.final.elapsedMs,120000);assert.equal(done.answers[a.questionKeys[0]].value,'A');assert.ok(done.conditions.includes('timer_adjusted'));
 assert.throws(()=>adjustCetTimer(done,target(done),'reset',undefined,at(125),'invalid'));assert.equal(done.finalizations.final.elapsedMs,120000);
});
test('countdown reset preserves 2 minutes, restarts complete 10 minute budget; paused stays paused',()=>{
 let a=createCetActivity({paper,purpose:'self_test',owner:'A',minutes:10,now:at(0)});a=adjustCetTimer(a,target(a),'reset',undefined,at(120),'reset');
 assert.equal(cetRemainingMs(a,Date.parse(at(120))),600000);assert.equal(cetElapsedMs(a,Date.parse(at(120))),120000);
 a=cetPause(a,at(150),'pause');a=adjustCetTimer(a,target(a),'countdown',5,at(160),'config');assert.equal(a.status,'paused');assert.equal(cetRemainingMs(a,Date.parse(at(900))),300000);assert.equal(cetElapsedMs(a,Date.parse(at(900))),150000);
 a=cetResume(a,at(900),'resume');assert.equal(cetRemainingMs(a,Date.parse(at(910))),290000);
});
test('invalid scope/budget/revision and expiry cannot reset; retry is idempotent',()=>{
 const a=createCetActivity({paper,purpose:'self_test',owner:'A',minutes:1,now:at(0)});
 for(const value of [0,181,1.5,NaN])assert.throws(()=>adjustCetTimer(a,target(a),'countdown',value,at(1),'invalid'));
 assert.throws(()=>adjustCetTimer(a,{...target(a),owner:'B'},'reset',undefined,at(1),'x'));
 assert.throws(()=>adjustCetTimer(a,target(a),'reset',undefined,at(60),'late'));
 const b=adjustCetTimer(a,target(a),'reset',undefined,at(10),'once');assert.deepEqual(adjustCetTimer(b,target(a),'reset',undefined,at(20),'once'),b);
});
test('practice adjustment only affects current section display; expiry caps time but leaves answers editable',()=>{
 let a=createCetActivity({paper,purpose:'practice',owner:'A',now:at(0)});a={...a,timerParts:{[a.activeSection+'#a']:90000,[a.sectionIds[1]+'#b']:40000},elapsedMs:130000};
 a=adjustCetTimer(a,target(a),'countdown',1,at(90),'config');const p=projectCetTimer(a,a.activeSection,Date.parse(at(200)),70000);
 assert.equal(p.remaining,0);assert.equal(p.total,150000);assert.equal(a.status,'in_progress');assert.equal(Object.keys(a.finalizations).length,0);
 assert.equal(projectCetTimer(a,a.sectionIds[1],Date.parse(at(200))).total,40000);
});
test('same v4 activity allows mode change; late old epoch timer cannot undo reset and terminal wins',()=>{
 const old=createCetActivity({paper,purpose:'self_test',owner:'A',timerMode:'countup',now:at(0)});
 const a=adjustCetTimer(old,target(old),'reset',undefined,at(10),'a');const b=adjustCetTimer(a,target(a),'countdown',2,at(20),'b');
 const merged=mergeCetActivity(a,b);assert.equal(projectCetTimer(merged,merged.activeSection,Date.parse(at(20))).remaining,120000);
 const done=cetFinalize(b,paper,'manual_submit',undefined,at(25),'final');assert.equal(mergeCetActivity(done,a).status,'submitted');
});


test('fallback storage upgrade retains v3 source, one logical history and late old draft recovery',()=>{
 const data=new Map<string,string>();const storage:Storage={get length(){return data.size;},clear(){data.clear();},getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);},key:i=>[...data.keys()][i]??null};
 const old=createCetActivity({paper,purpose:'self_test',owner:'A',timerMode:'countup',now:at(0)});
 saveCetActivity(old,storage);const adjusted=adjustCetTimer(old,target(old),'reset',undefined,at(10),'upgrade');saveCetActivity(adjusted,storage);
 assert.ok(storage.getItem(CET_ACTIVITIES_V3_KEY)?.includes(old.id));assert.equal(readCetActivities(storage).length,1);
 const late=cetAnswer(old,old.questionKeys[0],'B',at(20),'late');saveCetActivity(late,storage);
 const restored=readCetActivities(storage)[0];assert.ok(restored.schemaVersion===4);assert.equal(restored.answers[old.questionKeys[0]],undefined);assert.ok(restored.conditions.includes('legacy_draft_conflict'));assert.ok(Object.values(restored.legacyDraftRecovery||{}).some(a=>a!==null && typeof a==='object' && (a as {answers?:Record<string,{value?:unknown}>}).answers?.[old.questionKeys[0]]?.value==='B'));
});

test('epoch ancestry outranks a stale future clock and merge is order independent',()=>{
 const old=createCetActivity({paper,purpose:'self_test',owner:'A',timerMode:'countup',now:at(0)});
 const a=adjustCetTimer(old,target(old),'reset',undefined,at(10),'a');const b=adjustCetTimer(a,target(a),'countdown',2,at(20),'b');
 const stale={...a,timerRevision:at(9999)+':stale',updatedAt:at(9999)};
 const left=mergeCetActivity(stale,b),right=mergeCetActivity(b,stale);
 assert.deepEqual(left,right);assert.equal(projectCetTimer(left,left.activeSection,Date.parse(at(20))).remaining,120000);
});
