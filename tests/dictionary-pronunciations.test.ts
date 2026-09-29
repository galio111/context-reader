import test from "node:test";
import assert from "node:assert/strict";
import { parseDictionaryStream } from "../lib/dictionaryStream";

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
