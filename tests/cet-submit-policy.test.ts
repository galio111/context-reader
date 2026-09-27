import test from "node:test";
import assert from "node:assert/strict";
import { cetSubmitPolicy } from "../lib/cetSubmitPolicy";

const base = { purpose: "practice" as const, status: "in_progress" as const, sectionIds: ["a"], sectionId: "a", activeSectionId: "a", finalized: false, mismatch: false };
test("single fixed scope offers passage command on every surface", () => {
  for (const sectionId of ["a", undefined]) {
    const policy = cetSubmitPolicy({ ...base, sectionId });
    assert.deepEqual(policy.questions, ["passage_submit"]);
    assert.equal(policy.toolbar.command, "passage_submit");
    assert.equal(policy.toolbar.label, "提交本篇");
  }
  assert.equal(cetSubmitPolicy({ ...base, finalized: true }).toolbar.label, "本篇已提交");
  assert.equal(cetSubmitPolicy({ ...base, finalized: true }).toolbar.disabled, true);
});
test("multi passage last scope keeps batch action, malformed scope stays blocked", () => {
  assert.deepEqual(cetSubmitPolicy({ ...base, sectionId: undefined, sectionIds: ["a", "b"], activeSectionId: "b" }).questions, ["passage_submit", "submit_all"]);
  assert.deepEqual(cetSubmitPolicy({ ...base, sectionId: undefined, sectionIds: ["a", "b"] }).questions, ["passage_submit"]);
  for (const sectionIds of [[], ["a", "a"], ["a", "b"]]) {
    const policy = cetSubmitPolicy({ ...base, sectionIds });
    assert.equal(policy.toolbar.disabled, true);
    assert.deepEqual(policy.questions, []);
  }
});
test("self test retains finalization semantics without practice commands", () => {
  const policy = cetSubmitPolicy({ ...base, purpose: "self_test" });
  assert.deepEqual(policy.questions, ["manual_submit"]);
  assert.equal(policy.toolbar.command, "manual_submit");
  assert.equal(policy.toolbar.label, "提交自测");
});
