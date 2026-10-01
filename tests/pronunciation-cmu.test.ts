import test from "node:test";
import assert from "node:assert/strict";
import { ipaToCmu, pronunciationSynthesisInput } from "../lib/pronunciationSsml";
import { normalizeDictionarySpelling } from "../lib/dictionarySpelling";
import { reviewedDictionaryPronunciations, groupDictionaryPronunciations } from "../lib/dictionaryPronunciation";
import type { DictionaryResult } from "../types/dictionary";

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
