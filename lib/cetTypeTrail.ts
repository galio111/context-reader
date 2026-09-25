import type { CetPaper, CetPurpose, CetType } from '../types/cet';
export interface CetTypeUnit { paperId: string; sectionId: string }
export interface CetTrailKey { owner: string; level: 4|6; type: CetType; purpose: CetPurpose }
export interface CetTrailEvent extends CetTrailKey, CetTypeUnit {
 id: string; activityId: string; at: string; reason: 'answer'|'assistance_shown'|'finalized'|'restart'|'round'; round: string;
}
export const cetUnitKey = (unit: CetTypeUnit) => JSON.stringify([unit.paperId,unit.sectionId]);
export const cetTrailKey = (key: CetTrailKey) => JSON.stringify([key.owner,key.level,key.type,key.purpose]);
export function listAccessibleUnits(papers: CetPaper[], level:4|6,type:CetType):CetTypeUnit[]{
 const units=new Map<string,CetTypeUnit>();
 for(const paper of papers)if(paper.level===level)for(const section of paper.sections)if(section.type===type){const u={paperId:paper.id,sectionId:section.id};units.set(cetUnitKey(u),u);}
 return [...units.values()];
}
export function mergeTrailEvents(...sets:CetTrailEvent[][]):CetTrailEvent[]{
 const events=new Map<string,CetTrailEvent>();
 for(const e of sets.flat()){
  if(!e || typeof e.id!=='string'||typeof e.owner!=='string'||![4,6].includes(e.level)||!['cloze','matching','detail'].includes(e.type)
   ||!['practice','self_test'].includes(e.purpose)||!['answer','assistance_shown','finalized','restart','round'].includes(e.reason)
   ||typeof e.paperId!=='string'||typeof e.sectionId!=='string'||typeof e.round!=='string'||typeof e.activityId!=='string'||!Number.isFinite(Date.parse(e.at)))continue;
  const old=events.get(e.id);if(!old||JSON.stringify(e)>JSON.stringify(old))events.set(e.id,e);
 }
 return [...events.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}
export function currentTrailRound(events:CetTrailEvent[],key:CetTrailKey):string{
 return mergeTrailEvents(events).filter(e=>cetTrailKey(e)===cetTrailKey(key)&&e.reason==='round').at(-1)?.id||'initial';
}
export function projectTrail(events:CetTrailEvent[],key:CetTrailKey,units:CetTypeUnit[]){
 const accessible=new Set(units.map(cetUnitKey)),round=currentTrailRound(events,key),byUnit=new Map<string,CetTrailEvent>();
 for(const event of mergeTrailEvents(events)){
  if(cetTrailKey(event)!==cetTrailKey(key)||event.reason==='round'||event.round!==round)continue;
  const id=cetUnitKey(event),existing=byUnit.get(id);
  if(!existing)byUnit.set(id,event);
  else if(event.reason==='restart')byUnit.set(id,{...existing,activityId:event.activityId});
 }
 return {round,trail:[...byUnit.values()].filter(e=>accessible.has(cetUnitKey(e))),inaccessible:[...byUnit.values()].filter(e=>!accessible.has(cetUnitKey(e)))};
}
export function resolvePrevious(trail:CetTrailEvent[],current:CetTypeUnit):CetTrailEvent|undefined{
 const i=trail.findIndex(e=>cetUnitKey(e)===cetUnitKey(current));return i<0?trail.at(-1):trail[i-1];
}
export function resolveNext(trail:CetTrailEvent[],units:CetTypeUnit[],current:CetTypeUnit,fixed:CetTypeUnit|null,rng:()=>number):CetTypeUnit|undefined{
 const i=trail.findIndex(e=>cetUnitKey(e)===cetUnitKey(current));if(i>=0&&trail[i+1])return trail[i+1];
 const seen=new Set(trail.map(cetUnitKey));const remaining=units.filter(u=>!seen.has(cetUnitKey(u))&&cetUnitKey(u)!==cetUnitKey(current));
 if(fixed&&remaining.some(u=>cetUnitKey(u)===cetUnitKey(fixed)))return fixed;
 return remaining.length?remaining[Math.min(remaining.length-1,Math.max(0,Math.floor(rng()*remaining.length)))]:undefined;
}
export function trailPosition(trail:CetTrailEvent[],units:CetTypeUnit[],current:CetTypeUnit):number{
 if(!units.some(u=>cetUnitKey(u)===cetUnitKey(current)))return 0;
 const i=trail.findIndex(e=>cetUnitKey(e)===cetUnitKey(current));return Math.min(units.length,i<0?trail.length+1:i+1);
}
