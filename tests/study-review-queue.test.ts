import test from "node:test";
import assert from "node:assert/strict";
import { drainStudyReviews, migrateStudyReview, readStudyReviews, storeStudyReview, type PendingStudyReview } from "../lib/studyReviewQueue";
import { activeStudySnapshot, chooseStudyCard, remainingStudyCounts } from "../lib/studyPresentation";
import { DEFAULT_STUDY_SETTINGS, newMemory, planProgress, scheduleStudy } from "../lib/studyScheduler";
import type { StudyCard, StudySnapshot } from "../types/study";

class StorageMock {
  items = new Map<string, string>();
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}
const operation = (n: number): PendingStudyReview => ({op:"review",id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,cardId:String(n).padStart(40,"a"),version:2,token:"00000000-0000-4000-8000-000000000099",answer:"remembered",activeMs:2000,queuedAt:n});
const snapshot = (second = 1) => ({serverNow:`2026-10-13T00:00:0${second}.000Z`} as StudySnapshot);
const callbacks = () => ({active:()=>true,changed:()=>{},saved:()=>{},conflict:()=>{}});
const deferred = <T>() => { let resolve!:(v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; };

test("answers remain durable and account isolated while serial background saving waits",async()=>{
  const storage=new StorageMock(), a=operation(1), b=operation(2), c=operation(3);
  storeStudyReview(storage,"A",a);storeStudyReview(storage,"A",b);storeStudyReview(storage,"B",c);
  const wait=deferred<{snapshot:StudySnapshot}>(), calls:PendingStudyReview[]=[], saved:StudySnapshot[]=[];
  const drain=drainStudyReviews(storage,"A",async<T>(body?:unknown)=>{calls.push(body as PendingStudyReview);return (calls.length===1?await wait.promise:{snapshot:snapshot(2)}) as T;},{...callbacks(),saved:s=>saved.push(s)});
  assert.deepEqual(calls,[a]);assert.equal(readStudyReviews(storage,"A").length,2);assert.equal(saved.length,0);
  wait.resolve({snapshot:snapshot()});await drain;
  assert.deepEqual(calls,[a,b]);assert.equal(saved.length,2);assert.deepEqual(readStudyReviews(storage,"A"),[]);assert.deepEqual(readStudyReviews(storage,"B"),[c]);
});

test("a committed answer with a lost response retries its identical id without double recording",async()=>{
  const storage=new StorageMock(), item=operation(1);storeStudyReview(storage,"A",item);
  const committed=new Set<string>(), sent:PendingStudyReview[]=[];
  const api=async<T>(body?:unknown)=>{const p=body as PendingStudyReview;sent.push(p);committed.add(p.id);if(sent.length===1)throw new TypeError("network");return {snapshot:snapshot()} as T;};
  await assert.rejects(drainStudyReviews(storage,"A",api,callbacks()));
  assert.deepEqual(readStudyReviews(storage,"A"),[item]);
  await drainStudyReviews(storage,"A",api,callbacks());
  assert.equal(committed.size,1);assert.deepEqual(sent,[item,item]);assert.equal(storage.length,0);
});

test("too-fast retries retain the timing guard and immutable answer",async()=>{
  const storage=new StorageMock(), item=operation(1);storeStudyReview(storage,"A",item);
  const sent:unknown[]=[], waits:number[]=[];
  await drainStudyReviews(storage,"A",async<T>(body?:unknown)=>{sent.push(body);if(sent.length===1)throw Object.assign(new Error(),{code:"too_fast"});return {snapshot:snapshot()} as T;},callbacks(),async ms=>{waits.push(ms);});
  assert.deepEqual(waits,[850]);assert.deepEqual(sent,[item,item]);assert.equal(storage.length,0);
});

test("unmount or account switch fences delayed responses and leaves the answer for recovery",async()=>{
  const storage=new StorageMock(), item=operation(1);storeStudyReview(storage,"A",item);
  const wait=deferred<{snapshot:StudySnapshot}>();let active=true,accepted=0;
  const result=drainStudyReviews(storage,"A",async<T>()=>await wait.promise as T,{...callbacks(),active:()=>active,saved:()=>{accepted++;}});
  active=false;wait.resolve({snapshot:snapshot()});await result;
  assert.equal(accepted,0);assert.deepEqual(readStudyReviews(storage,"A"),[item]);
  await drainStudyReviews(storage,"A",async<T>()=>({snapshot:snapshot()}) as T,callbacks());
  assert.equal(storage.length,0);
});

test("a concurrent state change resolves only after a fresh authoritative read succeeds",async()=>{
  const storage=new StorageMock(), item=operation(1);storeStudyReview(storage,"A",item);let conflicts=0;
  const cb={...callbacks(),conflict:()=>{conflicts++;}};
  await assert.rejects(drainStudyReviews(storage,"A",async(body?:unknown)=>{if(body)throw Object.assign(new Error(),{code:"state_changed"});throw new TypeError("offline");},cb));
  assert.deepEqual(readStudyReviews(storage,"A"),[item]);assert.equal(conflicts,0);
  await drainStudyReviews(storage,"A",async<T>(body?:unknown)=>{if(body)throw Object.assign(new Error(),{code:"state_changed"});return snapshot() as T;},cb);
  assert.equal(storage.length,0);assert.equal(conflicts,1);
});

test("legacy session pending migration preserves identity, and a failed write retains the old record",()=>{
  const storage=new StorageMock(), session=new StorageMock(), old:Partial<PendingStudyReview>={...operation(1)};
  delete old.queuedAt;
  session.setItem("context-reader-study-pending:A",JSON.stringify(old));
  const original=storage.setItem;storage.setItem=()=>{throw new Error("quota");};
  assert.throws(()=>migrateStudyReview(storage,session,"A"));assert.equal(session.length,1);
  storage.setItem=original;migrateStudyReview(storage,session,"A");
  assert.equal(session.length,0);assert.deepEqual(readStudyReviews(storage,"A"),[{...old,queuedAt:0}]);
});

test("independent answer keys survive another tab's write and immutable id reuse is rejected",()=>{
  const storage=new StorageMock(), a=operation(1), b=operation(2);
  storeStudyReview(storage,"A",a);storeStudyReview(storage,"A",b);storeStudyReview(storage,"A",a);
  assert.deepEqual(readStudyReviews(storage,"A"),[a,b]);
  assert.throws(()=>storeStudyReview(storage,"A",{...a,answer:"forgot"}));
  assert.deepEqual(readStudyReviews(storage,"A"),[a,b]);
});

const now=new Date("2026-10-13T00:00:00Z");
const card=(id:string,state=0):StudyCard=>({id,entry_id:id,mode:"basic_en_to_cn",memory:{...newMemory(now),state},version:0,suspended:false,anki_pending:false,created_at:now.toISOString()});

test("pending cards are skipped immediately without inventing completed counts or FSRS states",()=>{
  const cards=[card("learning",1),card("review",2),card("new")],ids=cards.map(c=>c.id);
  const confirmed=planProgress(cards,ids,now, ["new"]);
  const pending=new Set(["learning"]);
  const available=planProgress(cards.filter(c=>!pending.has(c.id)),ids,now,["new"]);
  assert.equal(chooseStudyCard(available.ready,"learning","ordered",new Map())?.id,"review");
  assert.equal(confirmed.finished,0);assert.deepEqual(remainingStudyCounts(cards,ids,now),{learning:1,review:1});
  assert.equal(cards[0].memory.state,1);
});

test("remaining counts track graduation, wrong review, timed learning and valid today plan only",()=>{
  const learning=card("learning",1),review=card("review",2),future=card("future",2),outside=card("outside",1),suspended={...card("suspended",1),suspended:true},imported={...card("anki",1),anki_pending:true},fresh=card("new");
  future.memory.due="2026-10-14T00:00:00Z";
  const state={settings:DEFAULT_STUDY_SETTINGS,cards:[learning,review,future,outside,suspended,imported,fresh],entries:[]} as unknown as StudySnapshot;
  const cards=activeStudySnapshot(state).cards,ids=["learning","review","future","suspended","anki","new"];
  assert.deepEqual(remainingStudyCounts(cards,ids,now),{learning:1,review:1});
  learning.memory={...learning.memory,due:"2026-10-13T00:05:00Z"};
  assert.deepEqual(remainingStudyCounts(cards,ids,now),{learning:1,review:1});
  review.memory=scheduleStudy(review.memory,"forgot",now,.9).memory;
  assert.deepEqual(remainingStudyCounts(cards,ids,now),{learning:2,review:0});
  learning.memory={...learning.memory,state:2,last_review:now.toISOString(),due:"2026-10-15T00:00:00Z"};
  assert.deepEqual(remainingStudyCounts(cards,ids,now),{learning:1,review:0});
  assert.deepEqual(remainingStudyCounts(cards,ids,now,true),{learning:0,review:0});
});
