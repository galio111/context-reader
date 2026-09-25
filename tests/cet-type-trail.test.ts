import test from 'node:test';import assert from 'node:assert/strict';
import {historicalTrailEvents,mergeTrailEvents,projectTrail,resolveNext,resolvePrevious,trailPosition,type CetTrailKey,type CetTrailEvent} from '../lib/cetTypeTrail';
import {readFileSync} from 'node:fs';
import {createCetActivity,cetAnswer} from '../lib/cetActivity';
import type {CetPaper,CetExposure} from '../types/cet';
const key:CetTrailKey={owner:'A',level:6,type:'detail',purpose:'practice'};
const units=['A','B','C'].map(paperId=>({paperId,sectionId:'detail2'}));
const event=(i:number):CetTrailEvent=>({...key,...units[i],id:`e${i}`,activityId:`activity${i}`,at:`2026-09-25T00:00:0${i}Z`,reason:'answer',round:'initial'});
test('historical adaptation uses attributable answer/assist evidence, never read or updatedAt',()=>{
 const paper=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-12-1.json',import.meta.url),'utf8')) as CetPaper;
 const section=paper.sections[0];const a=createCetActivity({paper,sectionId:section.id,purpose:'practice',owner:'A',now:'2026-09-25T00:00:00Z'});
 const read:CetExposure={schemaVersion:2,id:'read',owner:'A',paperId:paper.id,sectionId:section.id,materialId:section.id,kind:'read',attemptId:a.id,occurredAt:'2026-09-25T00:00:01Z'};
 assert.deepEqual(historicalTrailEvents([a],[read],[paper],'A'),[]);
 assert.deepEqual(historicalTrailEvents([a],[{...read,kind:'assist',attemptId:undefined}],[paper],'A'),[]);
 const assist={...read,id:'assist',kind:'assist' as const};
 const answered=cetAnswer(a,a.questionKeys[0],'C','2026-09-25T00:00:02Z','answer');
 const adapted=historicalTrailEvents([answered],[assist],[paper],'A');
 assert.equal(adapted.length,1);assert.equal(adapted[0].at,assist.occurredAt);assert.equal(adapted[0].activityId,a.id);
 assert.equal(adapted[0].reason,'assistance_shown');assert.equal(mergeTrailEvents(adapted,adapted).length,1);
 assert.deepEqual(historicalTrailEvents([answered],[assist],[paper],'B'),[]);
});
test('A/B/C effective trace, previews do not occupy slots and back/forward restores original activity',()=>{
 let events:CetTrailEvent[]=[];let trail=projectTrail(events,key,units).trail;
 assert.equal(trailPosition(trail,units,units[0]),1);assert.equal(resolvePrevious(trail,units[0]),undefined);
 assert.deepEqual(resolveNext(trail,units,units[0],null,()=>0),units[1]);
 events=[event(0)];trail=projectTrail(events,key,units).trail;
 assert.equal(trailPosition(trail,units,units[1]),2);assert.equal(trailPosition(trail,units,units[2]),2);
 assert.equal(resolvePrevious(trail,units[1])?.activityId,'activity0');
 events=mergeTrailEvents(events,[event(1),event(2),event(0)]);trail=projectTrail(events,key,units).trail;
 assert.equal(trail.length,3);assert.equal(resolveNext(trail,units,units[0],null,()=>{throw Error('must not draw');})?.paperId,'B');
 assert.equal(resolveNext(trail,units,units[2],null,()=>0),undefined);assert.equal(trailPosition(trail,units,units[0]),1);
});
test('race/order dedup, purpose/owner isolation, accessible projection and fixed retry',()=>{
 const events=mergeTrailEvents([event(2),event(0)],[event(1),event(0)]);assert.deepEqual(events.map(e=>e.id),['e0','e1','e2']);
 assert.equal(projectTrail(events,{...key,purpose:'self_test'},units).trail.length,0);assert.equal(projectTrail(events,{...key,owner:'B'},units).trail.length,0);
 const partial=projectTrail(events,key,[units[0],units[2]]);assert.equal(partial.inaccessible.length,1);assert.equal(trailPosition(partial.trail,[units[0],units[2]],units[2]),2);
 assert.equal(trailPosition([],[],units[0]),0);assert.equal(resolveNext([], [units[0]],units[0],null,()=>0),undefined);
 assert.deepEqual(resolveNext([],units,units[0],units[2],()=>{throw Error('retry must not draw');}),units[2]);
});
test('explicit restart replaces activity binding without adding material; new round retains old events',()=>{
 const restart={...event(0),id:'restart',reason:'restart' as const,activityId:'new-A',at:'2026-09-25T01:00:00Z'};
 const events=mergeTrailEvents([event(0),event(1)],[restart]);const p=projectTrail(events,key,units);
 assert.equal(p.trail.length,2);assert.equal(p.trail[0].activityId,'new-A');
 const round={...event(0),id:'round2',reason:'round' as const,at:'2026-09-25T02:00:00Z'};
 assert.equal(projectTrail([...events,round],key,units).trail.length,0);assert.equal(events.length,3);
});
