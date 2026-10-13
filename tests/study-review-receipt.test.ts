import test from "node:test";
import assert from "node:assert/strict";
import { applyStudyReviewReceipt } from "../lib/studyReviewReceipt";
import { drainStudyReviews,readStudyReviews,storeStudyReview,type PendingStudyReview } from "../lib/studyReviewQueue";
import { newMemory } from "../lib/studyScheduler";
import type { StudySnapshot,StudyReviewReceipt } from "../types/study";

const now=new Date("2026-10-13T08:00:00Z"),memory=newMemory(now);
const pending:PendingStudyReview={op:"review",id:"00000000-0000-4000-8000-000000000001",cardId:"a".repeat(40),token:"00000000-0000-4000-8000-000000000002",version:0,answer:"remembered",activeMs:1000,queuedAt:now.getTime()};
const receipt:StudyReviewReceipt={serverNow:now.toISOString(),card:{id:pending.cardId,entry_id:"word",mode:"basic_en_to_cn",memory:{...memory,state:1},version:1,suspended:false,anki_pending:false,created_at:now.toISOString()},review:{id:pending.id,card_id:pending.cardId,answer:pending.answer,rating:3,reviewed_at:now.toISOString(),active_ms:1000,undone:false,previous:memory,next:{...memory,state:1}},todayStats:{day:"2026-10-13",cards:1,new_cards:1,active_ms:1000,successes:1,reviews:1}};
class StorageMock{items=new Map<string,string>();get length(){return this.items.size;}key(i:number){return [...this.items.keys()][i]??null;}getItem(k:string){return this.items.get(k)??null;}setItem(k:string,v:string){this.items.set(k,v);}removeItem(k:string){this.items.delete(k);}}
test("receipt unlocks queue without a full-library request; a lost response retries the immutable answer",async()=>{
 const storage=new StorageMock();storeStudyReview(storage,"owner",pending);let attempts=0,confirmed=0;
 const api=async<T>(body?:unknown)=>{assert.deepEqual(body,{...pending,response:"receipt"});attempts++;if(attempts===1)throw new TypeError("lost response");return {saved:true,id:pending.id,receipt} as T;};
 const cb={active:()=>true,changed:()=>{},saved:()=>{throw new Error("full snapshot not expected");},conflict:()=>{},confirmed:()=>{assert.equal(storage.length,1,"apply before removing durable answer");confirmed++;}};
 await assert.rejects(drainStudyReviews(storage,"owner",api,cb));assert.deepEqual(readStudyReviews(storage,"owner"),[pending]);
 await drainStudyReviews(storage,"owner",api,cb);assert.equal(storage.length,0);assert.equal(confirmed,1);
});
test("invalid or unrelated receipts never remove a pending answer",async()=>{
 for(const response of [{},{saved:true,id:pending.id,receipt:{...receipt,review:{...receipt.review,id:pending.token}}},{saved:true,id:pending.token,receipt}]){
  const storage=new StorageMock();storeStudyReview(storage,"owner",pending);
  await assert.rejects(drainStudyReviews(storage,"owner",async<T>()=>response as T,{active:()=>true,changed:()=>{},saved:()=>{},conflict:()=>{},confirmed:()=>{throw new Error("must not confirm");}}));
  assert.deepEqual(readStudyReviews(storage,"owner"),[pending]);
 }
});
test("receipt updates counts once and prevents an old snapshot resurrecting a saved card",()=>{
 const initial={serverNow:new Date(now.getTime()-1000).toISOString(),cards:[{...receipt.card,version:0,memory}],reviews:[],daily:[],entries:[]} as unknown as StudySnapshot;
 const updated=applyStudyReviewReceipt(initial,receipt);
 assert.equal(updated.cards[0].memory.state,1);assert.equal(updated.daily[0].new_cards,1);
 assert.deepEqual(applyStudyReviewReceipt(updated,receipt),updated);
 const later={...updated,serverNow:new Date(now.getTime()+1000).toISOString(),cards:[{...receipt.card,version:2}],daily:[{...receipt.todayStats!,new_cards:2}]};
 assert.equal(applyStudyReviewReceipt(later,receipt).cards[0].version,2);assert.equal(applyStudyReviewReceipt(later,receipt).daily[0].new_cards,2);
});
