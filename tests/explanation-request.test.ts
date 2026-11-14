import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeExplanationRequest } from "../lib/explanationRequest";

test("long target sentences retain the selected occurrence and ending while only background is shortened", () => {
  const sentence = "Two systems were compared for " + "measured material properties, ".repeat(25) + "therapeutic efficacy in a wound model.";
  assert.ok(sentence.indexOf("efficacy") > 500);
  const prepared = sanitizeExplanationRequest({ word:"efficacy", sentence, previousSentence:"The efficacy of a different product was reported. "+"background ".repeat(70), nextSentence:"next context ".repeat(70) });
  assert.equal(prepared.sentence, sentence);
  assert.ok(prepared.sentence.includes("therapeutic efficacy"));
  assert.ok(prepared.sentence.endsWith("wound model."));
  assert.ok(prepared.previousSentence.length <= 220);
  assert.ok(prepared.nextSentence.length <= 220);
});

test("context trimming retains the adjacent end of previous background without changing target identity", () => {
  const prepared = sanitizeExplanationRequest({word:" kinetics ",sentence:" Complete kinetics sentence. ",previousSentence:"background ".repeat(80)+"The adjacent cause.",nextSentence:"The adjacent result. "+"background ".repeat(80)});
  assert.equal(prepared.word,"kinetics");
  assert.equal(prepared.sentence,"Complete kinetics sentence.");
  assert.ok(prepared.previousSentence.endsWith("The adjacent cause."));
  assert.ok(prepared.nextSentence.startsWith("The adjacent result."));
});
