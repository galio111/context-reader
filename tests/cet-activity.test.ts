import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cetAnswer,
  cetEligibility,
  cetFinalize,
  cetPause,
  cetPracticeSectionElapsedMs,
  cetRemainingMs,
  cetResume,
  cetTimingAnomaly,
  createCetActivity,
  mergeCetActivity,
} from "../lib/cetActivity";
import type { CetActivity, CetPaper } from "../types/cet";

const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;
const t0 = "2026-09-23T00:00:00.000Z";
const make = (purpose: "practice" | "self_test" = "practice", sectionId?: string) => createCetActivity({ paper, purpose, sectionId, owner: "guest", id: "attempt", now: t0 });

test("new self-test has independent empty answers and an automatic fixed budget", () => {
  const testRun = make("self_test");
  assert.deepEqual(testRun.answers, {});
  assert.equal(testRun.budgetMs, 40 * 60_000);
  assert.equal(cetRemainingMs(testRun, Date.parse(t0) + 5_000), 40 * 60_000 - 5_000);
  assert.throws(() => createCetActivity({ paper, purpose: "self_test", owner: "guest", minutes: 181 }));
});

test("practice selections stay draft until the passage is submitted; a submitted passage freezes", () => {
  const first = paper.sections[0];
  const second = paper.sections[1];
  const key = `${first.id}:${first.questions[0].number}`;
  const secondKey = `${second.id}:${second.questions[0].number}`;
  let run = make();
  run = cetAnswer(run, key, "A", "2026-09-23T00:00:01.000Z", "e1");
  run = cetAnswer(run, key, "", "2026-09-23T00:00:02.000Z", "e2");
  assert.equal(run.answers[key].value, "");
  assert.deepEqual(run.finalizations, {});
  run = cetFinalize(run, paper, "passage_submit", first.id, "2026-09-23T00:00:03.000Z", "f1");
  assert.equal(run.status, "in_progress");
  assert.equal(run.finalizations.f1.unanswered >= 1, true);
  assert.equal(cetAnswer(run, key, "B"), run);
  run = cetAnswer(run, secondKey, "C", "2026-09-23T00:00:04.000Z", "e3");
  assert.equal(run.answers[secondKey].value, "C");
  assert.equal(cetFinalize(run, paper, "passage_submit", first.id).finalizations.f1, run.finalizations.f1);
});

test("practice snapshots keep each passage's study time separate", () => {
  const [first, second] = paper.sections;
  const run = { ...make(), timerParts: { [`${first.id}#one`]: 12_000, [`${second.id}#two`]: 8_000 }, elapsedMs: 20_000 };
  assert.equal(cetPracticeSectionElapsedMs(run, first.id), 12_000);
  const submitted = cetFinalize(run, paper, "passage_submit", second.id, "2026-09-23T00:00:21.000Z", "second");
  assert.equal(submitted.finalizations.second.elapsedMs, 8_000);
  assert.equal(submitted.elapsedMs, 20_000);
});

test("explicit pause preserves remaining budget; hiding time does not pause", () => {
  const run = make("self_test");
  const paused = cetPause(run, "2026-09-23T00:00:10.000Z", "p1");
  assert.equal(paused.status, "paused");
  assert.equal(paused.everPaused, true);
  assert.equal(cetRemainingMs(paused, Date.parse(t0) + 50_000), 40 * 60_000 - 10_000);
  const resumed = cetResume(paused, "2026-09-23T00:00:50.000Z", "r1");
  assert.equal(cetRemainingMs(resumed, Date.parse(t0) + 60_000), 40 * 60_000 - 20_000);
  assert.equal(cetEligibility(cetFinalize(resumed, paper, "manual_submit")), "conditions_incomplete");
});

test("a clock rollback is retained as a condition rather than presented as a standard test", () => {
  const run = make("self_test");
  assert.equal(cetTimingAnomaly(run, Date.parse(t0) - 10_000), true);
  const paused = cetPause(run, "2026-09-22T23:59:50.000Z", "rollback");
  assert.ok(paused.conditions.includes("timing_anomaly"));
});

test("finalization is immutable under late drafts, replay and concurrent different submissions", () => {
  const base = make("self_test");
  const key = base.questionKeys[0];
  const a = cetFinalize(cetAnswer(base, key, "A", "2026-09-23T00:00:01.000Z", "a"), paper, "manual_submit", undefined, "2026-09-23T00:00:02.000Z", "fa");
  const late = cetAnswer(base, key, "B", "2026-09-23T00:00:03.000Z", "b");
  const merged = mergeCetActivity(a, late);
  assert.equal(merged.finalizations.fa.answers[key], "A");
  assert.equal(merged.status, "submitted");
  assert.deepEqual(mergeCetActivity(merged, a), merged);
  const b = cetFinalize(late, paper, "manual_submit", undefined, "2026-09-23T00:00:04.000Z", "fb");
  const conflict = mergeCetActivity(a, b);
  assert.deepEqual(conflict, mergeCetActivity(b, a));
  assert.deepEqual(Object.keys(conflict.finalizations).sort(), ["fa", "fb"]);
  assert.equal(conflict.conditions.includes("submission_conflict"), true);
  assert.equal(cetEligibility(conflict), "conditions_incomplete");
  assert.equal(cetEligibility(a, ["answer_view_during_test"]), "conditions_incomplete");
});

test("merge of edits and snapshots is idempotent, commutative and associative", () => {
  const base = make();
  const [k1, k2] = base.questionKeys;
  const variants: CetActivity[] = [
    cetAnswer(base, k1, "A", "2026-09-23T00:00:01.000Z", "a"),
    cetAnswer(base, k1, "", "2026-09-23T00:00:01.000Z", "z"),
    cetAnswer(base, k2, "B", "2026-09-23T00:00:02.000Z", "b"),
  ];
  const [a, b, c] = variants;
  assert.deepEqual(mergeCetActivity(a, a), a);
  assert.deepEqual(mergeCetActivity(a, b), mergeCetActivity(b, a));
  assert.deepEqual(mergeCetActivity(mergeCetActivity(a, b), c), mergeCetActivity(a, mergeCetActivity(b, c)));
  assert.equal(mergeCetActivity(a, b).answers[k1].value, "");
});
