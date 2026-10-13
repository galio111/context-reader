import test from "node:test";
import assert from "node:assert/strict";
import { getStudyEntries, STUDY_ENTRY_SELECT } from "../lib/studyStore";

test("study reads paginate compact vocabulary fields without fetching saved dictionary payloads",async()=>{
  const originalFetch=globalThis.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="http://supabase-api:8000";process.env.SUPABASE_SERVICE_ROLE_KEY="isolated-test";
  const pages:number[]=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    assert.equal(url.searchParams.get("user_id"),"eq.account-A");
    assert.equal(url.searchParams.get("kind"),"eq.vocabulary");
    assert.equal(url.searchParams.get("deleted_at"),"is.null");
    assert.equal(url.searchParams.get("select"),STUDY_ENTRY_SELECT);
    assert.ok(!STUDY_ENTRY_SELECT.split(",").includes("payload"));
    assert.ok(!STUDY_ENTRY_SELECT.includes("dictionaryResult"));
    assert.ok(STUDY_ENTRY_SELECT.includes("dictionaryUpdatedAt:payload->dictionaryUpdatedAt"));
    const offset=Number(url.searchParams.get("offset"));pages.push(offset);
    return Response.json(Array.from({length:offset===0?500:2},(_,i)=>({object_key:String(offset+i),id:String(offset+i),word:"word"+i,anki:{cardMode:"basic_en_to_cn"}})));
  };
  try {
    const entries=await getStudyEntries("account-A");
    assert.equal(entries.length,502);assert.deepEqual(pages,[0,500]);assert.equal(entries[501].id,"501");
    assert.ok(entries.every(entry=>!Object.hasOwn(entry,"object_key")&&!Object.hasOwn(entry,"dictionaryResult")));
  } finally {
    globalThis.fetch=originalFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});
