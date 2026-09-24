import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCetActivity, cetAnswer, cetElapsedMs, cetPause, cetResume, cetFinalize, cetRemainingMs, mergeCetActivity } from "../lib/cetActivity";
import { cetViewModel } from "../lib/cetViewModel";
import { cetTextTokens } from "../lib/cetTextTokens";
import { CET_ACTIVITIES_KEY, CET_ACTIVITIES_V3_KEY, CET_FINALIZATIONS_KEY, CET_FINALIZATIONS_V3_KEY, saveCetActivity, readCetActivities, readCetCommitPackages, cetActivityPrefix, cetCommitPrefix } from "../lib/cetActivityStorage";
import { readCetActivities as readV2Activities, readCetCommitPackages as readV2Commits, normalizeCetActivity as normalizeV2 } from "./fixtures/cet-v2-storage";
import { claimGuestCetRecords, accountSyncKindsForStorageKey } from "../lib/accountSyncClient";
import type { CetPaper } from "../types/cet";
const paper=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-12-1.json',import.meta.url),'utf8')) as CetPaper;
const t0=Date.parse('2026-09-24T00:00:00.000Z'), at=(seconds:number)=>new Date(t0+seconds*1000).toISOString();
const make=(timerMode:'countup'|'countdown'='countup')=>createCetActivity({paper,purpose:'self_test',owner:'guest',id:'test',now:at(0),timerMode});
class MemoryStorage implements Storage {
 data=new Map<string,string>();get length(){return this.data.size;}clear(){this.data.clear();}getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}key(i:number){return [...this.data.keys()][i]??null;}
}
test('countup has no budget, survives elapsed background time and explicit pause/resume',()=>{
 let a=make();assert.equal(a.schemaVersion,3);assert.equal(a.budgetMs,undefined);assert.equal(cetRemainingMs(a,t0+10_000_000),Infinity);
 assert.equal(cetElapsedMs(a,t0+30_000),30_000);a=cetPause(a,at(30),'pause');assert.equal(cetElapsedMs(a,t0+90_000),30_000);
 a=cetResume(a,at(100),'resume');assert.equal(a.id,'test');assert.equal(cetElapsedMs(a,t0+120_000),50_000);
 a=cetAnswer(a,a.questionKeys[0],'A',at(200),'answer');assert.equal(a.answers[a.questionKeys[0]].value,'A');
 const result=cetFinalize(a,paper,'manual_submit',undefined,at(220),'finish');assert.equal(result.finalizations.finish.elapsedMs,150_000);assert.equal(result.finalizations.finish.timerMode,'countup');assert.equal(cetElapsedMs(result,t0+900_000),150_000);
 assert.deepEqual(cetFinalize(result,paper,'manual_submit',undefined,at(230),'again'),result);
});
test('countdown settles once, expiry blocks late answers, and validation stays strict',()=>{
 for(const minutes of [0,-1,1.1,181,NaN])assert.throws(()=>createCetActivity({paper,purpose:'self_test',owner:'guest',minutes}));
 let a=make('countdown');a=cetPause(a,at(30),'pause');a=cetResume(a,at(100),'resume');assert.equal(cetRemainingMs(a,t0+120_000),40*60_000-50_000);
 assert.deepEqual(cetAnswer(a,a.questionKeys[0],'A',at(5000),'late'),a);
 const done=cetFinalize(a,paper,'time_expired',undefined,at(5000),'expired');assert.equal(done.finalizations.expired.elapsedMs,40*60_000);assert.equal(done.finalizations.expired.everPaused,true);
});
test('one scope model covers a paper, each type, clear answers and imported scope mismatches',()=>{
 assert.equal(cetViewModel(paper,null).total,30);
 for(const s of paper.sections){const a=createCetActivity({paper,purpose:'practice',owner:'guest',sectionId:s.id});const v=cetViewModel(paper,a);assert.equal(v.total,s.questions.length);assert.equal(v.sections.length,1);assert.equal(v.mismatch,false);}
 let a=make();a=cetAnswer(a,a.questionKeys[0],'A',at(1),'a');assert.equal(cetViewModel(paper,a).answered,1);a=cetAnswer(a,a.questionKeys[0],'',at(2),'b');assert.equal(cetViewModel(paper,a).answered,0);
 assert.equal(cetViewModel(paper,{...a,questionKeys:[...a.questionKeys,'missing:999']}).mismatch,true);
});
test('half-submitted practice reveals only frozen section results and retains neutral drafts',()=>{
 let a=createCetActivity({paper,purpose:'practice',owner:'guest',now:at(0)});const [first,second]=paper.sections;
 const key=`${first.id}:${first.questions[0].number}`, draft=`${second.id}:${second.questions[0].number}`;
 a=cetAnswer(a,key,first.questions[0].answer!,at(1),'a');a=cetFinalize(a,paper,'passage_submit',first.id,at(2),'one');a=cetAnswer(a,draft,'A',at(3),'b');
 const model=cetViewModel(paper,a);assert.equal(model.state(first.id,key),'correct');assert.equal(model.state(second.id,draft),'answered');assert.equal(model.answered,2);
 assert.equal(model.state(first.id,`${first.id}:${first.questions[1].number}`),'unanswered');
});
test('selected conflicting self-test snapshot controls every answer, count and result even after reference change',()=>{
 const a=make(),key=a.questionKeys[0];const left=cetFinalize(cetAnswer(a,key,'A',at(1),'a'),paper,'manual_submit',undefined,at(2),'left');
 const right=cetFinalize(cetAnswer(a,key,'B',at(1),'b'),paper,'manual_submit',undefined,at(3),'right');const merged=mergeCetActivity(left,right);
 const changed=structuredClone(paper);changed.sections[0].questions[0].answer='Z';
 for(const id of ['left','right']){const model=cetViewModel(changed,merged,undefined,id);assert.equal(model.answer(a.sectionIds[0],key),id==='left'?'A':'B');assert.equal(model.answered,1);assert.equal(model.snapshotFor(a.sectionIds[0])?.id,id);assert.notEqual(model.sections[0].questions[0].answer,'Z');}
});
test('ending practice from already submitted last passage retains every earlier draft without completed-count inflation',()=>{
 let a=createCetActivity({paper,purpose:'practice',owner:'guest',now:at(0)});const last=paper.sections.at(-1)!;
 const key=a.questionKeys[0];a=cetAnswer(a,key,'A',at(1),'a');a=cetFinalize(a,paper,'passage_submit',last.id,at(2),'last');
 a={...a,timerParts:{[`${paper.sections[0].id}#timer`]:5000},elapsedMs:5000};const ended=cetFinalize(a,paper,'ended_for_study',undefined,at(3),'end');
 assert.equal(ended.status,'ended');assert.deepEqual(ended.finalizations.last,a.finalizations.last);assert.equal(ended.finalizations.end.answers[key],'A');assert.equal(ended.finalizations.end.elapsedMs,5000);
 assert.equal(Object.values(ended.finalizations).filter(f=>f.sectionId).length,1);assert.equal(cetViewModel(paper,ended).answered,1);
});
test('reference missing from frozen result is unverified, never counted correct',()=>{
 const copy=structuredClone(paper);copy.sections[0].questions[0].answer=undefined;const a=createCetActivity({paper:copy,purpose:'self_test',owner:'guest',timerMode:'countup',now:at(0)});
 const done=cetFinalize(a,copy,'manual_submit',undefined,at(1),'done');assert.equal(cetViewModel(copy,done).state(a.sectionIds[0],a.questionKeys[0]),'unverified');assert.equal(done.finalizations.done.unreliable,1);
});
test('fragment offsets and unique token ids distinguish repeated words after multiple cloze gaps',()=>{
 const source='First word [[26]] second word. Later [[27]] word arrives.';
 const offset=source.indexOf(' word arrives');const tokens=cetTextTokens(source.slice(offset),'fragment-two',source,offset);const word=tokens.find(t=>t.type==='word')!;
 assert.equal(word.value,'word');assert.equal(word.start,source.lastIndexOf('word'));assert.equal(word.sentence,'Later [[27]] word arrives.');
 const first=cetTextTokens('word','fragment-one');assert.notEqual(first[0].id,word.id);assert.ok(!tokens.some(t=>/26|27/.test(t.value)));
});
test('v3 activity and commit stay outside v2 collections through persistence, guest claim and replay',()=>{
 const storage=new MemoryStorage();saveCetActivity(make('countdown'),storage);let a=make();a={...a,id:'up'};a=cetFinalize(cetAnswer(a,a.questionKeys[0],'C',at(1),'a'),paper,'manual_submit',undefined,at(2),'up-final');saveCetActivity(a,storage);
 assert.equal(JSON.parse(storage.getItem(CET_ACTIVITIES_KEY)!)[0].schemaVersion,2);assert.equal(JSON.parse(storage.getItem(CET_ACTIVITIES_V3_KEY)!)[0].schemaVersion,3);assert.equal(storage.getItem(CET_FINALIZATIONS_KEY),'[]');assert.equal(JSON.parse(storage.getItem(CET_FINALIZATIONS_V3_KEY)!).length,1);
 // Execute the captured v2 storage code: v3 never enters the old timer path.
 assert.equal(normalizeV2(a),null);assert.equal(readV2Activities(storage).length,1);assert.equal(readV2Activities(storage)[0].schemaVersion,2);assert.equal(readV2Commits(storage).length,0);
 const oldRecords=JSON.parse(storage.getItem(CET_ACTIVITIES_KEY)!);storage.setItem(CET_ACTIVITIES_KEY,JSON.stringify(oldRecords));
 claimGuestCetRecords(storage,'account-A');claimGuestCetRecords(storage,'account-A');const restored=readCetActivities(storage).find(r=>r.id==='up')!;assert.equal(restored.owner,'account-A');assert.equal(restored.finalizations['up-final'].answers[a.questionKeys[0]],'C');assert.equal(restored.elapsedMs,2000);assert.equal(cetActivityPrefix(restored),'cet-activity:v3:');assert.equal(cetCommitPrefix(readCetCommitPackages(storage)[0]),'cet-finalization:v3:');assert.deepEqual(accountSyncKindsForStorageKey(CET_ACTIVITIES_V3_KEY),['preferences']);
});
