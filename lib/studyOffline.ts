import type { StudyAnswer, StudySnapshot, StudyReviewReceipt,StudyCard,StudyReview,StudySettings,StudyDay } from "@/types/study";
import { buildStudyPlan, scheduleStudy, shanghaiDay, studyDayEnd, studyRating, sanitizeStudySettings, budgetSettings } from "./studyScheduler";

export type StudyLocalEvent = {id:string; at:string; permit:string} & (
  {kind:"review";cardId:string;answer:StudyAnswer;activeMs:number} |
  {kind:"undo";reviewId:string} | {kind:"settings";settings:StudySnapshot["settings"]}
);
export interface StudyLocalRecord {owner:string;base:StudySnapshot;events:StudyLocalEvent[];clockOffset?:number}
export interface StudyLocalAck {id:string;serverNow:string;card?:StudyCard;review?:StudyReview;settings?:StudySettings;today?:StudyDay;removedCardId?:string;outcome:Record<string,boolean>}
export function acknowledgeStudyEvent(record:StudyLocalRecord,ack:StudyLocalAck):StudyLocalRecord{
  if(!record.events.some(e=>e.id===ack.id))return record;
  const base=record.base;
  const cards=base.cards.filter(c=>c.id!==ack.removedCardId).map(c=>c.id===ack.card?.id&&c.version<=ack.card.version?ack.card:c);
  const reviews=ack.review?[ack.review,...base.reviews.filter(r=>r.id!==ack.review!.id)]:base.reviews;
  return {...record,base:{...base,cards,reviews,settings:ack.settings??base.settings,today:ack.today??base.today,serverNow:ack.serverNow},events:record.events.filter(e=>e.id!==ack.id)};
}

export function localStudyDay(snapshot:StudySnapshot,now:Date):StudySnapshot {
  const settings=budgetSettings(snapshot.settings);
  const ids=buildStudyPlan(snapshot.cards,settings,now,snapshot.today,snapshot.reviews);
  if(snapshot.today?.day===shanghaiDay(now)) {
    return {...snapshot,settings,today:{...snapshot.today,card_ids:ids,settings:{...snapshot.today.settings,...settings}}};
  }
  return {...snapshot,settings,today:{day:shanghaiDay(now),card_ids:ids,new_ids:snapshot.cards.filter(c=>ids.includes(c.id)&&[0,1].includes(c.memory.state)).map(c=>c.id),settings,reward_points:0,completed_at:null,new_completed:0,streak:0}};
}
export function applyLocalStudyEvent(snapshot:StudySnapshot,event:StudyLocalEvent):StudySnapshot {
  const now=new Date(event.at);
  snapshot=localStudyDay(snapshot,now);
  if(event.kind==="settings")return localStudyDay({...snapshot,settings:sanitizeStudySettings(event.settings,snapshot.settings)},now);
  if(event.kind==="undo"){
    const review=snapshot.reviews.find(r=>r.id===event.reviewId);
    if(!review||review.undone)return snapshot;
    const later=snapshot.reviews.some(r=>!r.undone&&r.card_id===review.card_id&&Date.parse(r.reviewed_at)>Date.parse(review.reviewed_at));
    if(later)return snapshot;
    return {...snapshot,cards:snapshot.cards.map(c=>c.id===review.card_id?{...c,memory:review.previous,version:c.version+1}:c),reviews:snapshot.reviews.map(r=>r.id===review.id?{...r,undone:true}:r)};
  }
  if(snapshot.reviews.some(r=>r.id===event.id))return snapshot;
  const card=snapshot.cards.find(c=>c.id===event.cardId&&!c.suspended);
  if(!card)return snapshot;
  const at=new Date(Math.max(now.getTime(),Date.parse(card.memory.last_review??event.at)));
  const memory=scheduleStudy(card.memory,event.answer,at,snapshot.settings.retention,snapshot.settings).memory;
  return {...snapshot,cards:snapshot.cards.map(c=>c.id===card.id?{...c,memory,version:c.version+1}:c),reviews:[{id:event.id,card_id:card.id,answer:event.answer,rating:studyRating(event.answer),reviewed_at:at.toISOString(),active_ms:event.activeMs,undone:false,previous:card.memory,next:memory},...snapshot.reviews]};
}
export function projectStudyRecord(record:StudyLocalRecord,now=new Date(Date.now()+(record.clockOffset??0))):StudySnapshot {
  let snapshot=record.events.reduce(applyLocalStudyEvent,record.base);
  snapshot=localStudyDay(snapshot,now);
  // Recompute today's distinct-word counters from the complete daily ledger,
  // including reversals. Local projections never create points or entitlements.
  const day=shanghaiDay(now), rows=snapshot.reviews.filter(r=>!r.undone&&shanghaiDay(new Date(r.reviewed_at))===day);
  const grouped=new Map<string,typeof rows>();
  for(const r of rows)grouped.set(r.card_id,[...(grouped.get(r.card_id)??[]),r]);
  let fresh=0,review=0,learning=0;
  for(const rs of grouped.values()){
    // Match study_daily_stats_v3: category follows what was actually studied,
    // not the resulting memory state or whether the word graduated today.
    if(rs.some(r=>r.previous.state===0))fresh++;
    else if(rs.some(r=>[2,3].includes(r.previous.state)))review++;
    else learning++;
  }
  const daily={day,cards:grouped.size,new_cards:fresh,review_cards:review,learning_cards:learning,active_ms:rows.reduce((n,r)=>n+r.active_ms,0),successes:rows.filter(r=>r.rating>1).length,reviews:rows.length};
  return {...snapshot,serverNow:now.toISOString(),daily:[...snapshot.daily.filter(d=>d.day!==day),daily]};
}
export function localReceipt(snapshot:StudySnapshot,id:string):StudyReviewReceipt {
  const review=snapshot.reviews.find(r=>r.id===id)!;
  return {serverNow:snapshot.serverNow,review,card:snapshot.cards.find(c=>c.id===review.card_id)!,todayStats:snapshot.daily.find(d=>d.day===shanghaiDay(new Date(snapshot.serverNow)))};
}
export function canUndoStudy(snapshot:StudySnapshot,id:string,now:Date) {
  const r=snapshot.reviews.find(r=>r.id===id&&!r.undone);
  return !!r&&now.getTime()-Date.parse(r.reviewed_at)<=15*60000&&!snapshot.reviews.some(x=>!x.undone&&x.card_id===r.card_id&&Date.parse(x.reviewed_at)>Date.parse(r.reviewed_at));
}
export function finishedForStudyDay(snapshot:StudySnapshot,now:Date){return snapshot.cards.filter(c=>c.memory.state===2&&Date.parse(c.memory.due)>=studyDayEnd(now).getTime());}
