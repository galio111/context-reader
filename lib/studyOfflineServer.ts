import "server-only";
import {getStudySettings,studyRows,studyRpc} from "./studyStore";
import {accountFetch} from "./accountStore";
import {buildStudyPlan,sanitizeStudySettings,scheduleStudy,STUDY_ALGORITHM} from "./studyScheduler";
import {verifyStudyOfflinePermit} from "./studyOfflinePermit";
import type {StudyLocalEvent,StudyLocalAck} from "./studyOffline";
import type {StudyCard,StudyReview,StudyDay} from "@/types/study";
import {shanghaiDay} from "./studyScheduler";

export async function saveStudyLocalEvent(owner:string,input:unknown){
 const event=input as StudyLocalEvent;
 if(!event||! /^[0-9a-f-]{36}$/i.test(event.id)||typeof event.permit!=="string"||!verifyStudyOfflinePermit(event.permit,owner,event.at))throw new Error("Invalid offline study event");
 if(!["review","undo","settings"].includes(event.kind))throw new Error("Invalid offline operation");
 if(event.kind==="review"&&(!/^[a-f0-9]{40}$/.test(event.cardId)||!["forgot","unsure_wrong","unsure_right","remembered"].includes(event.answer)||!Number.isInteger(event.activeMs)||event.activeMs<0||event.activeMs>60000))throw new Error("Invalid offline answer");
 if(event.kind==="undo"&&!/^[0-9a-f-]{36}$/i.test(event.reviewId))throw new Error("Invalid offline undo");
 for(let attempt=0;attempt<4;attempt++){
  const [settings,cards]=await Promise.all([getStudySettings(owner),studyRows<StudyCard>("study_cards",owner,"*","&order=id.asc")]);
  const card=event.kind==="review"?cards.find(c=>c.id===event.cardId):undefined;
  const at=new Date(Math.max(Date.parse(event.at),Date.parse(card?.memory.last_review??event.at)));
  const next=event.kind==="settings"?sanitizeStudySettings(event.settings,settings):settings;
  const memory=card&&event.kind==="review"?scheduleStudy(card.memory,event.answer,at,settings.retention,settings).memory:null;
  const outcome=await studyRpc<Record<string,boolean>>("local_event_v1",{p_user:owner,p_event:event,p_version:card?.version??0,p_memory:memory,p_settings:next,p_ids:buildStudyPlan(cards,settings,new Date(event.at)),p_algorithm:STUDY_ALGORITHM});
  if(outcome.retry)continue;
  if(outcome.blocked)throw new Error("Offline card not eligible");
  const reviewId=event.kind==="review"?event.id:event.kind==="undo"?event.reviewId:null;
  const reviews=reviewId?await accountFetch<StudyReview[]>("study_reviews?user_id=eq."+owner+"&id=eq."+reviewId+"&select=id,card_id,answer,rating,reviewed_at,active_ms,undone,previous,next&limit=1"):[];
  const cardId=event.kind==="review"?event.cardId:reviews[0]?.card_id;
  const [updated,days]=await Promise.all([
   cardId?accountFetch<StudyCard[]>("study_cards?user_id=eq."+owner+"&id=eq."+cardId+"&select=id,entry_id,mode,memory,version,suspended,anki_pending,created_at&limit=1"):[],
   accountFetch<StudyDay[]>("study_days?user_id=eq."+owner+"&day=eq."+shanghaiDay(new Date())+"&select=*&limit=1")]);
  const ack:StudyLocalAck={id:event.id,serverNow:new Date().toISOString(),outcome,card:updated[0],review:reviews[0],settings:event.kind==="settings"?next:undefined,today:days[0],removedCardId:outcome.removed&&event.kind==="review"?event.cardId:undefined};
  return {ack};
 }
 throw new Error("Offline study state busy");
}
