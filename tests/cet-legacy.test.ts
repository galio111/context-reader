import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptLegacyCetAttempt } from "../lib/cetLegacy";
import { cetEligibility, cetRemainingMs } from "../lib/cetActivity";
import type { CetAttempt, CetPaper } from "../types/cet";

const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;
const section = paper.sections[0];
const raw = (patch: Partial<CetAttempt> = {}): CetAttempt => ({
  id: "old", scope: `paper:${paper.id}`, paperId: paper.id, activeSection: section.id,
  title: paper.title, mode: "exam", answers: {}, answerTimes: {}, revealed: {},
  elapsedMs: 43000, timerEpoch: "2026-09-22T00:00:00Z", timerParts: { oldTimer: 43000 },
  createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:03:00Z", ...patch,
});

test("unfinished legacy exam keeps answers, early reveal and manual-time provenance", () => {
  const key = `${section.id}:${section.questions[0].number}`;
  const old = raw({ answers: { [key]: "B" }, revealed: { [section.id]: "2026-09-22T00:02:00Z" } });
  const mapped = adaptLegacyCetAttempt(old, paper, "guest");
  assert.equal(mapped.answers[key].value, "B");
  assert.equal(mapped.legacy?.raw.revealed[section.id], old.revealed[section.id]);
  assert.equal(mapped.budgetMs, undefined);
  assert.equal(mapped.elapsedMs, 43000);
  assert.equal(cetRemainingMs(mapped), Number.POSITIVE_INFINITY);
  assert.ok(mapped.conditions.includes("legacy_early_reveal"));
});

test("finished legacy exam is read-only with a snapshot and unknown conditions", () => {
  const old = raw({ finishedAt: "2026-09-22T00:03:00Z" });
  const mapped = adaptLegacyCetAttempt(old, paper, "guest");
  assert.equal(mapped.status, "submitted");
  assert.equal(Object.values(mapped.finalizations)[0].elapsedMs, 43000);
  assert.equal(cetEligibility(mapped), "conditions_incomplete");
});

test("finished legacy study retains every section without claiming a clean new practice", () => {
  const key = `${section.id}:${section.questions[0].number}`;
  const mapped = adaptLegacyCetAttempt(raw({ mode: "study", answers: { [key]: "C" }, finishedAt: "2026-09-22T00:03:00Z" }), paper, "guest");
  assert.equal(mapped.finalizations[`legacy-final:old:${section.id}`].answers[key], "C");
  assert.equal(Object.keys(mapped.finalizations).length, paper.sections.length);
  assert.ok(mapped.conditions.includes("legacy_conditions_unknown"));
});
