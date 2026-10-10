import test from "node:test";
import assert from "node:assert/strict";
import { ipaToCmu, normalizePronunciationPhonetic, pronunciationSynthesisInput } from "../lib/pronunciationSsml";
import { normalizeDictionarySpelling } from "../lib/dictionarySpelling";
import { reviewedDictionaryPronunciations, groupDictionaryPronunciations } from "../lib/dictionaryPronunciation";
import type { DictionaryResult } from "../types/dictionary";

test("reported lever and esteem defaults normalize cached results and constrain their different vowels", () => {
  for (const [query, ipa, phones] of [
    ["lever", ["/ˈlevər/", "/ˈliːvə/"], ["L EH1 V ER0", "L IY1 V AH0"]],
    ["esteem", ["/ɪˈstiːm/", "/ɪˈstiːm/"], ["IH0 S T IY1 M", "IH0 S T IY1 M"]],
  ] as const) {
    const result = normalizeDictionarySpelling({ query, lemma: query, direction: "en_to_cn", phonetic: "/old/", phoneticFor: query } as DictionaryResult);
    assert.deepEqual(result.pronunciations?.map(entry => entry.phonetic), [...ipa]);
    assert.equal(groupDictionaryPronunciations(result.pronunciations).length, 1);
    assert.deepEqual(result.pronunciations?.map(entry => ipaToCmu(entry.phonetic, entry.accent)), [...phones]);
  }
  assert.equal(ipaToCmu("/əˈstiːm/"), "AH0 S T IY1 M");
});

test("optional final r resolves by accent without stripping other unsupported notation", () => {
  assert.equal(normalizePronunciationPhonetic("/'li:və(r)/", "en-GB"), "ˈliːvə");
  assert.equal(ipaToCmu("/ˈliːvə(r)/", "en-GB"), "L IY1 V AH0");
  assert.equal(ipaToCmu("/ˈliːvə(r)/", "en-US"), "L IY1 V ER0");
  assert.equal(ipaToCmu("/ˈkæmə.rə/", "en-US"), "K AE1 M AH0 R AH0");
  assert.equal(ipaToCmu("/ˈtiːtʃər/", "en-US"), "T IY1 CH ER0");
  assert.equal(ipaToCmu("/ˈdɑːktər/", "en-US"), "D AA1 K T ER0");
  for (const value of ["/ˈliː(v)ə/", "/ˈliːvə(r)bad/", "<speak>lever</speak>"]) {
    assert.equal(normalizePronunciationPhonetic(value, "en-GB"), "");
  }
});

test("bass's explicit sense reading owns its vowel without the provider's spelling-default bias", () => {
  for (const accent of ["en-US","en-GB"] as const) for (const [ipa,phones] of [["/bæs/","B AE1 S"],["/beɪs/","B EY1 S"]]) {
    assert.deepEqual(pronunciationSynthesisInput("bass",ipa,accent), {
      text:`<speak><phoneme alphabet="cmu" ph="${phones}">word</phoneme>${accent==="en-US"?".":""}</speak>`,textType:"ssml",
    });
  }
  assert.deepEqual(pronunciationSynthesisInput("bass","","en-US"),{text:"bass",textType:"plain"});
  assert.match(pronunciationSynthesisInput("lever","/ˈlevər/","en-US").text,/>lever<\/phoneme>/);
});

test("CMU conversion preserves phonemes and primary/secondary stress across English words", () => {
  for (const [ipa, expected] of [
    ["/ˈbɝːɡlɚi/", "B ER1 G L ER0 IY0"],
    ["/ˈbɜːɡləri/", "B ER1 G L AH0 R IY0"],
    ["/ˈtɝːʃieri/", "T ER1 SH IY0 EH0 R IY0"],
    ["/ˈtɜːʃəri/", "T ER1 SH AH0 R IY0"],
    ["/ˌjuːnɪˈvɜːrsəti/", "Y UW2 N IH0 V ER1 S AH0 T IY0"],
    ["/ˈredʒɪmənt/", "R EH1 JH IH0 M AH0 N T"],
    ["/əˈbaʊt/", "AH0 B AW1 T"],
    ["/kæt/", "K AE1 T"],
    ["/bɔɪ/", "B OY1"],
    ["/tʃeɪndʒ/", "CH EY1 N JH"],
    ["/ˈkəʊ.lə/", "K OW1 L AH0"],
    ["/ˈkɛɹi/", "K EH1 R IY0"],
  ]) assert.equal(ipaToCmu(ipa), expected, ipa);
});

test("US monosyllables get a complete utterance ending without changing their consonants or other accents", () => {
  for (const [word, ipa, phones] of [
    ["peg", "/peɡ/", "P EH1 G"], ["bag", "/bæɡ/", "B AE1 G"],
    ["leg", "/leɡ/", "L EH1 G"], ["big", "/bɪɡ/", "B IH1 G"],
    ["dog", "/dɔːɡ/", "D AO1 G"], ["egg", "/eɡ/", "EH1 G"],
    ["cat", "/kæt/", "K AE1 T"], ["book", "/bʊk/", "B UH1 K"],
    ["change", "/tʃeɪndʒ/", "CH EY1 N JH"], ["stay", "/steɪ/", "S T EY1"],
  ]) {
    assert.equal(ipaToCmu(ipa, "en-US"), phones);
    assert.deepEqual(pronunciationSynthesisInput(word, ipa, "en-US"), {
      text: `<speak><phoneme alphabet="cmu" ph="${phones}">${word}</phoneme>.</speak>`, textType: "ssml",
    });
    assert.ok(pronunciationSynthesisInput(word, ipa, "en-GB").text.endsWith("</phoneme></speak>"));
  }
  for (const [word, ipa] of [["lever", "/ˈlevər/"], ["esteem", "/ɪˈstiːm/"], ["teacher", "/ˈtiːtʃər/"]]) {
    assert.ok(pronunciationSynthesisInput(word, ipa, "en-US").text.endsWith("</phoneme></speak>"));
  }
  assert.deepEqual(pronunciationSynthesisInput("take in", "/ˈteɪkɪn/", "en-US"), {text:"take in",textType:"plain"});
});

test("alternate retains noun/adjective/verb readings and their distinct stress/vowel phones", () => {
  const entries = reviewedDictionaryPronunciations("alternate")!;
  assert.equal(entries.length, 6);
  assert.equal(groupDictionaryPronunciations(entries).length, 3);
  assert.deepEqual(entries.map(item => ipaToCmu(item.phonetic)), [
    "AA1 L T ER0 N AH0 T", "AA1 L T AH0 N AH0 T",
    "AA1 L T ER0 N AH0 T", "AA0 L T ER1 N AH0 T",
    "AA1 L T ER0 N EY0 T", "AA1 L T AH0 N EY0 T",
  ]);
});

test("unsupported or ambiguous IPA falls back to exactly the word, never partially converted phones", () => {
  for (const ipa of ["/kæt̚/", "/ˈbɜːɡlɹ̩i/", "/tɜʃəri/", "/kæˈt/", "/ˈˌkæt/", "/ˈtʔ/", "a".repeat(101)]) {
    assert.equal(ipaToCmu(ipa), "", ipa);
    assert.deepEqual(pronunciationSynthesisInput("tertiary", ipa), { text: "tertiary", textType: "plain" });
  }
  assert.equal(pronunciationSynthesisInput("take in", "/teɪkɪn/").textType, "plain");
  const longWord = "a".repeat(80);
  assert.deepEqual(pronunciationSynthesisInput(longWord, "/ˌjuːnɪˈvɜːrsəti/"), { text: longWord, textType: "plain" });
});

test("burglary and tertiary replace bad cached and regenerated pronunciation entries, without changing spelling", () => {
  for (const [query, expected] of [
    ["burglary", ["/ˈbɝːɡlɚi/", "/ˈbɜːɡləri/"]],
    ["tertiary", ["/ˈtɝːʃieri/", "/ˈtɜːʃəri/"]],
  ] as const) {
    const normalized = normalizeDictionarySpelling({ query, lemma: query, direction: "en_to_cn", phonetic: "/wrong/", phoneticFor: query, pronunciations: [{ accent: "en-US", partOfSpeech: "other", phonetic: "/wrong/" }] } as DictionaryResult);
    assert.equal(normalized.query, query);
    assert.equal(normalized.phoneticFor, query);
    assert.deepEqual(normalized.pronunciations?.map(item => item.phonetic), [...expected]);
    for (const item of normalized.pronunciations ?? []) {
      const synthesis = pronunciationSynthesisInput(query, item.phonetic);
      assert.equal(synthesis.textType, "ssml");
      assert.match(synthesis.text, /alphabet="cmu"/);
      assert.doesNotMatch(synthesis.text, /alphabet="ipa"|the |to /);
    }
  }
});
