import test from "node:test";
import assert from "node:assert/strict";
import { cetLearningSummary } from "../lib/cetLearningSummary";
import type { CetActivity, CetFinalization } from "../types/cet";

const final = (answers: Record<string, string>): CetFinalization => ({
  id: "submission", reason: "manual_submit", at: "2026-10-12T12:00:00Z",
  answers, questions: Array.from({ length: 175 }, (_, index) => ({
    key: String(index), sectionId: "s", number: index, stem: "", options: [{ key: "A", text: "" }, { key: "B", text: "" }], answer: "A",
  })),
  contentVersion: "v1", answerVersion: "v1", correct: 19, scoreable: 175, unanswered: 155,
  unreliable: 0, elapsedMs: 1000, everPaused: false, conditions: [],
});
const activity = (row: CetFinalization) => ({ finalizations: { [row.id]: row } }) as CetActivity;
test("personal CET accuracy excludes the 155 blank questions in a 175-question submission", () => {
  const row = final(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i), i < 19 ? "A" : "B"])));
  assert.deepEqual(cetLearningSummary([activity(row)]), { correct: 19, scoreable: 20, submissions: 1, excluded: 0 });
  assert.equal(row.scoreable, 175, "the saved exam score is unchanged");
});
test("blank submissions, unknown answer keys and invalid keys do not count", () => {
  assert.equal(cetLearningSummary([activity(final({}))]).scoreable, 0);
  const row = final({ "0": "A", "1": "A", "2": "A", "3": " ", "unknown": "A" });
  row.questions[0].answer = undefined;
  row.questions[1].answer = "X";
  assert.deepEqual(cetLearningSummary([activity(row)]), { correct: 1, scoreable: 1, submissions: 1, excluded: 0 });
});
test("personal accuracy uses frozen answers rather than the editable current draft or stale totals", () => {
  const row = final({ "0": "B" });
  assert.equal(cetLearningSummary([{ ...activity(row), answers: { "0": { value: "A", at: "", eventId: "" } } }]).correct, 0);
});
