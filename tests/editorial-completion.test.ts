import assert from "node:assert/strict";
import test from "node:test";
import { validEditorialCompletion } from "../lib/editorialReview";

test("editorial provider envelopes require both completion and billable usage", () => {
  assert.equal(validEditorialCompletion({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), true);
  assert.equal(validEditorialCompletion({ choices: [{ message: { content: "{}" } }] }), false);
  assert.equal(validEditorialCompletion({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: "120", completion_tokens: 30 } }), false);
  assert.equal(validEditorialCompletion({ error: "The request failed" }), false);
  assert.equal(validEditorialCompletion(null), false);
});
