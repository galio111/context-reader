import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { VocabularyEntry } from "../types/vocabulary";
import type { StudyCard, StudySnapshot } from "../types/study";
import { normalizeVocabularyEntries } from "../lib/vocabularyRepository";
import { vocabularyIdentity } from "../lib/vocabularyMerge";
import { activeStudySnapshot } from "../lib/studyPresentation";
import { compactStudyResponse, hydrateStudyResponse } from "../lib/studyTransport";

test("sentence collection is per owner, deduplicated, opt-in, and preserves review memory after removal and re-enrollment", async t => {
  const require=createRequire(import.meta.url);
  const path=require.resolve("../lib/accountStore"), prior=require.cache[path];
  t.after(()=>{if(prior)require.cache[path]=prior;else delete require.cache[path];});
  const objects=new Map<string,{payload:VocabularyEntry;server_version:number;deleted_at:null}>();
  const cards=new Map<string,StudyCard>();
  let writes=0, conflict=false;
  const mocked={
    async accountFetch(url:string,init?:RequestInit) {
      const u=new URL("https://fixture.test/"+url), owner=(u.searchParams.get("user_id")||"").slice(3);
      if(u.pathname==="/user_data_objects") {
        const r=objects.get(owner+":"+u.searchParams.get("object_key")?.slice(3));return r?[r]:[];
      }
      assert.equal(u.pathname,"/study_cards");
      if(init?.method==="POST") {for(const c of JSON.parse(String(init.body)))cards.set(c.user_id+":"+c.entry_id,{...c,suspended:false});return [];}
      if(init?.method==="PATCH") {const c=Array.from(cards.values()).find(x=>x.id===u.searchParams.get("id")?.slice(3));assert.ok(c);Object.assign(c,JSON.parse(String(init.body)));return [];}
      const c=cards.get(owner+":"+u.searchParams.get("entry_id")?.slice(3));return c?[c]:[];
    },
    async writeSyncObjects(owner:string,[o]:Array<{objectKey:string;payload:VocabularyEntry;serverVersion:number}>) {
      const key=owner+":"+o.objectKey, row=objects.get(key);
      if(conflict){conflict=false;return [{accepted:false}];}
      assert.equal(o.serverVersion,row?.server_version||0);writes++;
      objects.set(key,{payload:o.payload,server_version:o.serverVersion+1,deleted_at:null});return [{accepted:true}];
    },
  };
  require.cache[path]={id:path,filename:path,loaded:true,exports:mocked} as NodeModule;
  const {saveSelectedSentence,setSentenceStudyEnabled}=await import("../lib/savedSentencesServer");
  const {reconcileStudyCards}=await import("../lib/studyStore");
  const original="It was worth the wait.",zh="这次等待是值得的。";conflict=true;
  const first=await saveSelectedSentence("A",original,zh);
  assert.equal(first.entryKind,"sentence");assert.equal(first.sourceSentence,original);assert.equal(first.sentenceTranslation,zh);
  assert.equal(first.sentenceStudyEnabled,false);assert.equal(first.anki.cardMode,"basic_cn_to_en");
  assert.equal(normalizeVocabularyEntries([first])[0].entryKind,"sentence");
  assert.notEqual(vocabularyIdentity(first),vocabularyIdentity({...first,entryKind:undefined}));
  await saveSelectedSentence("A",original,zh);assert.equal(writes,1);
  await reconcileStudyCards("A",first); assert.equal(cards.size,0);
  await assert.rejects(setSentenceStudyEnabled("B",first.id,true),/已移除/);
  const included=await setSentenceStudyEnabled("A",first.id,true);
  await reconcileStudyCards("A",included);const card=cards.get("A:"+first.id)!;assert.ok(card);card.memory.reps=7;
  const updated=await saveSelectedSentence("A",original,"值得为此等待。");assert.equal(updated.id,first.id);assert.equal(updated.createdAt,first.createdAt);assert.equal(updated.sentenceStudyEnabled,true);
  const snapshot={serverNow:new Date().toISOString(),settings:{includeAnki:false},cards:[],entries:[updated],today:null} as unknown as StudySnapshot;
  assert.equal(activeStudySnapshot(snapshot).entries[0].id,first.id);
  assert.deepEqual(hydrateStudyResponse(compactStudyResponse(snapshot)).entries[0],updated);
  await reconcileStudyCards("A",await setSentenceStudyEnabled("A",first.id,false));assert.equal(card.suspended,true);
  await reconcileStudyCards("A",await setSentenceStudyEnabled("A",first.id,true));assert.equal(card.suspended,false);assert.equal(card.memory.reps,7);assert.equal(cards.size,1);
});
