import test from "node:test";
import assert from "node:assert/strict";
import { checkSpelling, spellingSentence } from "../lib/studySpelling";

test("normalizes typography and case, but preserves internal missing spaces", () => {
  for (const value of ["aspen", "ASPEN", "  ａｓｐｅｎ  "]) assert.ok(checkSpelling(value,"aspen").every(p=>p.kind==="equal"));
  assert.ok(checkSpelling("look   after", "look after").every(p=>p.kind==="equal"));
  assert.deepEqual(checkSpelling("lookafter", "look after"),[
    {kind:"equal",typed:"look",expected:"look"},{kind:"change",typed:"",expected:" "},{kind:"equal",typed:"after",expected:"after"},
  ]);
});
test("single substitution, missing and extra letters remain distinct", () => {
  assert.deepEqual(checkSpelling("aspan","aspen").filter(p=>p.kind==="change"),[{kind:"change",typed:"a",expected:"e"}]);
  assert.deepEqual(checkSpelling("aspe","aspen").filter(p=>p.kind==="change"),[{kind:"change",typed:"",expected:"n"}]);
  assert.deepEqual(checkSpelling("aspppen","aspen").filter(p=>p.kind==="change"),[{kind:"change",typed:"pp",expected:""}]);
});
test("transposition and coincidental isolated letters do not create false islands", () => {
  assert.deepEqual(checkSpelling("apsen","aspen"),[{kind:"equal",typed:"a",expected:"a"},{kind:"change",typed:"ps",expected:"sp"},{kind:"equal",typed:"en",expected:"en"}]);
  assert.deepEqual(checkSpelling("abxdyf","abcdef"),[{kind:"equal",typed:"ab",expected:"ab"},{kind:"change",typed:"xdy",expected:"cde"},{kind:"equal",typed:"f",expected:"f"}]);
  assert.deepEqual(checkSpelling("asxyz","aspen"),[{kind:"equal",typed:"as",expected:"as"},{kind:"change",typed:"xyz",expected:"pen"}]);
});
test("bounded diff reconstructs both spellings across deletions, insertions and wholly wrong answers", () => {
  for (const [a,b] of [["xyz","aspen"],["","word"],["abc",""],["helloworld","hello world"],["q".repeat(256),"aspen"],["aXbcYYdef","abcdef"]]) {
    const result=checkSpelling(a,b);
    assert.equal(result.map(p=>p.typed).join(""),a);
    assert.equal(result.map(p=>p.expected).join(""),b);
  }
});
test("sentence split masks one occurrence and uses the actual selected form", () => {
  assert.deepEqual(spellingSentence("Aspen growth and aspen trees.","aspen"),{before:"",expected:"Aspen",after:" growth and aspen trees."});
  assert.deepEqual(spellingSentence("They look after the trees.","look after"),{before:"They ",expected:"look after",after:" the trees."});
  assert.equal(spellingSentence("A different sentence.","aspen"),null);
});

test("existing underscores do not become the spelling target; long expected text never passes by truncation", () => {
  assert.deepEqual(spellingSentence("________ and aspen trees.","aspen"),{before:"________ and ",expected:"aspen",after:" trees."});
  assert.ok(checkSpelling("a".repeat(256),"a".repeat(300)).some(p=>p.kind==="change"));
});
