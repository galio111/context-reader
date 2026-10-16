import test from "node:test";
import assert from "node:assert/strict";
import { orderStudyVocabulary, shuffleStudyVocabularyIds } from "../lib/studyVocabularyOrder";
import type { VocabularyEntry } from "../types/vocabulary";

const entry=(id:string,word:string,createdAt:string,updatedAt=createdAt)=>({id,word,createdAt,updatedAt}) as VocabularyEntry;
test("collection order uses original creation time, including timezone offsets, never regeneration time",()=>{
 const entries=[entry("b","apple","2026-10-13T10:00:00+08:00"),entry("c","Zoo","2026-10-13T03:00:00Z"),entry("a","Banana","2026-10-13T01:00:00Z","2099-01-01")];
 assert.deepEqual(orderStudyVocabulary(entries,"collected").map(e=>e.id),["c","b","a"]);
 assert.deepEqual(entries.map(e=>e.id),["b","c","a"]);
 assert.deepEqual(orderStudyVocabulary(entries,"alphabetical").map(e=>e.word),["apple","Banana","Zoo"]);
});
test("same-time and legacy missing-time entries have stable fallback ordering",()=>{
 const entries=[entry("a","z",""),entry("b","y","2026-01-01"),entry("c","x","2026-01-01"),entry("d","w","invalid")];
 assert.deepEqual(orderStudyVocabulary(entries,"collected").map(e=>e.id),["b","c","a","d"]);
});
test("every shuffle preserves all records and cannot repeat the visible order even with unlucky randomness",()=>{
 const ids=["a","b","c","d"], first=shuffleStudyVocabularyIds(ids,ids,()=>.999999);
 assert.notDeepEqual(first,ids);assert.deepEqual([...first].sort(),ids);
 const next=shuffleStudyVocabularyIds(first,first,()=>.999999);
 assert.notDeepEqual(next,first);assert.deepEqual([...next].sort(),ids);assert.deepEqual(ids,["a","b","c","d"]);
 assert.deepEqual(shuffleStudyVocabularyIds([]),[]);assert.deepEqual(shuffleStudyVocabularyIds(["a"]),["a"]);
});
test("random order survives content refresh, and new entries append without losing any existing row",()=>{
 const entries=[entry("a","a","2026-01-01"),entry("b","b","2026-01-02"),entry("c","c","2026-01-03")];
 assert.deepEqual(orderStudyVocabulary(entries,"random",["b","a"]).map(e=>e.id),["b","a","c"]);
 assert.deepEqual(orderStudyVocabulary(entries.slice(1),"random",["b","a"]).map(e=>e.id),["b","c"]);
});
test("large vocabulary shuffle is linear and preserves all 10000 unique records",()=>{
 const ids=Array.from({length:10000},(_,i)=>String(i));let calls=0;
 const result=shuffleStudyVocabularyIds(ids,ids,()=>{calls++;return .5;});
 assert.equal(calls,ids.length-1);assert.equal(new Set(result).size,ids.length);
});
