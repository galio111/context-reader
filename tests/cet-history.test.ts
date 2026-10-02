import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cetAnswer, cetFinalize, createCetActivity, mergeCetActivity } from "../lib/cetActivity";
import { cetHistorySummary, matchesCetHistoryStatus } from "../lib/cetHistory";
import type { CetPaper } from "../types/cet";
const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;
const make = () => createCetActivity({ paper, purpose: "practice", owner: "guest", now: "2026-10-02T08:00:00Z" });

test("history uses frozen grades and submission time, never current draft answers", () => {
  const section = paper.sections[0];
  let run = createCetActivity({ paper, purpose: "practice", sectionId: section.id, owner: "guest" });
  run = cetAnswer(run, run.questionKeys[0], section.questions[0].answer!);
  run = cetFinalize(run, paper, "passage_submit", section.id, "2026-10-02T09:30:00Z", "final");
  const summary = cetHistorySummary(run);
  assert.equal(summary.submitted, true); assert.match(summary.score, /答对 1\//);
  assert.equal(summary.at, "2026-10-02T09:30:00Z");
  assert.equal(cetHistorySummary({ ...run, answers: {} }).score, summary.score);
  assert.equal(matchesCetHistoryStatus(run, "submitted"), true);
  assert.equal(matchesCetHistoryStatus(run, "unsubmitted"), false);
});

test("partial paper submissions and paused drafts stay in unsubmitted", () => {
  const partial = cetFinalize(make(), paper, "passage_submit", paper.sections[0].id);
  assert.equal(matchesCetHistoryStatus(partial, "unsubmitted"), true);
  assert.match(cetHistorySummary(partial).score, /已提交部分/);
  assert.equal(matchesCetHistoryStatus({ ...make(), status: "paused" }, "unsubmitted"), true);
  const ended = cetFinalize(make(), paper, "ended_for_study");
  assert.equal(matchesCetHistoryStatus(ended, "unsubmitted"), true);
  assert.equal(cetHistorySummary(ended).score, "未完成");
});

test("multiple conflicting answers never get summed into a misleading grade", () => {
  const base = make();
  const first = cetFinalize(base, paper, "passage_submit", paper.sections[0].id, undefined, "first");
  const other = cetFinalize(base, paper, "passage_submit", paper.sections[0].id, undefined, "other");
  assert.equal(cetHistorySummary(mergeCetActivity(first, other)).score, "多份答卷，查看成绩");
});
