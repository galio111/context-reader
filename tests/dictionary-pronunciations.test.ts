import test from "node:test";
import assert from "node:assert/strict";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import { groupDictionaryPronunciations } from "../lib/dictionaryPronunciation";
import { normalizeDictionarySpelling } from "../lib/dictionarySpelling";
import type { DictionaryResult } from "../types/dictionary";

test("dictionary keeps accent and noun/verb IPA for the queried spelling", () => {
  const head = {
    type: "head", query: "record", lemma: "record", phonetic: "/ˈrekɔːd/", phoneticFor: "record",
    direction: "en_to_cn", inputStatus: "valid",
    pronunciations: [
      { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈrekərd/" },
      { accent: "en-GB", partOfSpeech: "noun", phonetic: "/ˈrekɔːd/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "/rɪˈkɔːrd/" },
      { accent: "en-GB", partOfSpeech: "verb", phonetic: "/rɪˈkɔːd/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "" },
    ],
  };
  const parsed = parseDictionaryStream(`${JSON.stringify(head)}\n${JSON.stringify({type:"done"})}\n`, "record");
  assert.equal(parsed.result.pronunciations?.length, 4);
  assert.deepEqual([...new Set(parsed.result.pronunciations?.map(item => item.partOfSpeech))], ["noun", "verb"]);
  assert.equal(parseDictionaryStream(`${JSON.stringify({...head,inputStatus:"misspelled",suggestedQuery:"records"})}\n`, "recrod").result.pronunciations?.length, 0);
});

test("bass groups actual readings and repairs wrong guitar IPA in saved and streamed senses", () => {
  const wrong={query:"bass",lemma:"bass",direction:"en_to_cn",inputStatus:"ambiguous",senses:[
    {meaning:"贝斯（低音吉他）",partOfSpeech:"noun",phonetic:"/bæs/",headwordNote:"读 /bæs/，名词，指低音吉他（口语）"},
    {meaning:"低音的；低沉的",partOfSpeech:"adjective",phonetic:"/bæs/",headwordNote:"读 /bæs/"},
    {meaning:"鲈鱼",partOfSpeech:"noun",phonetic:"/beɪs/",headwordNote:"读 /beɪs/"},
  ]} as DictionaryResult;
  const result=normalizeDictionarySpelling(wrong);
  assert.deepEqual(result.senses.map(s=>s.phonetic),["/beɪs/","/beɪs/","/bæs/"]);
  assert.equal(result.senses[0].headwordNote,"读 /beɪs/，名词，指低音吉他（口语）");
  const groups=groupDictionaryPronunciations(result.pronunciations);
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].parts,["noun","adjective"]);
  assert.deepEqual(groups[0].meanings,["低音；贝斯"]);
  assert.deepEqual(groups[1].meanings,["鲈鱼"]);
  assert.deepEqual(groups.map(g=>g.entries.map(e=>e.phonetic)),[["/beɪs/","/beɪs/"],["/bæs/","/bæs/"]]);
  const streamed=parseDictionaryStream([JSON.stringify({type:"head",query:"bass"}),JSON.stringify({type:"sense",...wrong.senses[0]})].join("\n"),"bass");
  assert.equal(streamed.result.senses[0].phonetic,"/beɪs/");
});

test("meaning-based readings survive normalization and group across parts of speech", () => {
  const pronunciations=[
    {accent:"en-US",partOfSpeech:"noun",phonetic:"/liːd/",meaning:"领先"},
    {accent:"en-GB",partOfSpeech:"noun",phonetic:"/liːd/",meaning:"领先"},
    {accent:"en-US",partOfSpeech:"verb",phonetic:"/liːd/",meaning:"带领"},
    {accent:"en-GB",partOfSpeech:"verb",phonetic:"/liːd/",meaning:"带领"},
    {accent:"en-US",partOfSpeech:"noun",phonetic:"/led/",meaning:"铅"},
    {accent:"en-GB",partOfSpeech:"noun",phonetic:"/led/",meaning:"铅"},
  ] as DictionaryResult["pronunciations"];
  const result=normalizeDictionarySpelling({query:"lead",direction:"en_to_cn",pronunciations} as DictionaryResult);
  const groups=groupDictionaryPronunciations(result.pronunciations);
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].parts,["noun","verb"]);
  assert.deepEqual(groups[0].meanings,["领先","带领"]);
  assert.deepEqual(groups[1].meanings,["铅"]);
  // Legacy data without labels still separates noun variants instead of
  // treating every noun as a single pronunciation.
  assert.equal(groupDictionaryPronunciations(pronunciations!.map(({meaning,...entry})=>entry)).length,2);
});
