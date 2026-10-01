import test from "node:test";
import assert from "node:assert/strict";
import { groupDictionaryPronunciations, dictionaryPronunciationRows, phoneticComparisonKey } from "../lib/dictionaryPronunciation";
import { normalizePronunciationPhonetic, pronunciationSynthesisInput } from "../lib/pronunciationSsml";
import { normalizeDictionarySpelling } from "../lib/dictionarySpelling";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import type { DictionaryResult } from "../types/dictionary";

type Entry = NonNullable<DictionaryResult["pronunciations"]>[number];
const entry = (partOfSpeech: Entry["partOfSpeech"], phonetic: string, accent: Entry["accent"] = "en-US"): Entry => ({ partOfSpeech, phonetic, accent });

test("identical noun/verb readings and redundant other readings collapse into one group", () => {
  const groups = groupDictionaryPronunciations([
    entry("noun", "/ˈredʒɪment/"), entry("noun", "/ˈredʒɪment/", "en-GB"),
    entry("verb", "/ˈredʒɪment/"), entry("verb", "/ˈredʒɪment/", "en-GB"),
    entry("other", "/ˈredʒɪment/"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(dictionaryPronunciationRows(groups[0]).length, 1);
  assert.deepEqual(dictionaryPronunciationRows(groups[0])[0].accents, ["en-US", "en-GB"]);
});

test("hemisphere has one POS group and retains the real rhotic UK/US difference", () => {
  const groups = groupDictionaryPronunciations([
    entry("noun", "/ˈhemɪsfɪr/"), entry("noun", "/ˈhemɪsfɪə/", "en-GB"), entry("other", "/ˈhemɪsfɪr/"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(dictionaryPronunciationRows(groups[0]).length, 2);
});

test("record noun/verb stress and stewardess accent differences remain separate", () => {
  assert.equal(groupDictionaryPronunciations([entry("noun", "/ˈrekɔːd/"), entry("verb", "/rɪˈkɔːd/")]).length, 2);
  const groups = groupDictionaryPronunciations([entry("noun", "/ˈstuːərdəs/"), entry("noun", "/ˈstjuːədəs/", "en-GB")]);
  assert.equal(dictionaryPronunciationRows(groups[0]).length, 2);
  for (const [a, b] of [["/iː/", "/ɪ/"], ["/ər/", "/ə/"], ["/ˈrekɔːd/", "/rɪˈkɔːd/"]]) assert.notEqual(phoneticComparisonKey(a), phoneticComparisonKey(b));
});

test("equivalent IPA typography does not create duplicate rows", () => {
  const groups = groupDictionaryPronunciations([entry("noun", "/ˈhɛm.ɪ.sfɪɹ/"), entry("noun", "/'hemɪsfɪr/", "en-GB")]);
  assert.equal(dictionaryPronunciationRows(groups[0]).length, 1);
  assert.equal(phoneticComparisonKey("/ˈwɝd/"), phoneticComparisonKey("/ˈwɜːrd/"));
});

test("old cached and streamed plead IPA are corrected without confusing pled", () => {
  for (const [query, expected] of [["plead", "/pliːd/"], ["pled", "/pled/"]]) {
    const result = parseDictionaryStream(JSON.stringify({ type: "head", query, lemma: "plead", phonetic: "/pled/", phoneticFor: query, pronunciations: [entry("verb", "/pled/")] }) + "\n", query).result;
    assert.equal(normalizeDictionarySpelling(result).phonetic, expected);
    assert.deepEqual(result.pronunciations?.map(item => item.phonetic), [expected, expected]);
  }
});

test("SSML translates IPA to the supported CMU alphabet and cannot contain extra spoken words", () => {
  assert.equal(pronunciationSynthesisInput("plead", "/pliːd/").text, '<speak><phoneme alphabet="cmu" ph="P L IY1 D">plead</phoneme></speak>');
  assert.equal(normalizePronunciationPhonetic("/'pli:d/"), "ˈpliːd");
  for (const ipa of ['pli\"/><break/>', "i".repeat(101), "this is not IPA", ""]) assert.equal(normalizePronunciationPhonetic(ipa), "");
  assert.equal(pronunciationSynthesisInput("take in", "/teɪkɪn/").textType, "plain");
});
