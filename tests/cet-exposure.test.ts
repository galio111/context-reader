import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cetObservedConditions, exposureFor, priorCetSections } from "../lib/cetExposure";
import { createCetActivity, cetFinalize } from "../lib/cetActivity";
import type { CetPaper, CetSection } from "../types/cet";

const catalog = JSON.parse(readFileSync(new URL("../data/cet/catalog.json", import.meta.url), "utf8")) as CetPaper[];
const first = catalog.find((paper) => paper.id === "cet6-2022-09-1")!;
const second = catalog.find((paper) => paper.id === "cet6-2022-09-2")!;

test("strictly identical passages share material identity while different titles alone are insufficient", () => {
  assert.equal(first.sections[0].materialId, second.sections[0].materialId);
  const event = exposureFor(first.sections[0], first.id, "guest", "read", "r1", "old", "2026-09-23T00:00:00Z");
  assert.deepEqual(priorCetSections(second.sections, [event], "2026-09-23T00:01:00Z", "guest"), [second.sections[0].id]);
  const renamed = { ...second.sections[1], title: first.sections[0].title, materialId: "different-material" } as CetSection;
  assert.deepEqual(priorCetSections([renamed], [event], "2026-09-23T00:01:00Z", "guest"), []);
});

test("post-submission answer viewing does not retroactively contaminate the test", () => {
  const paper = JSON.parse(readFileSync(new URL("../data/cet/cet4-2025-12-1.json", import.meta.url), "utf8")) as CetPaper;
  paper.sections = paper.sections.map((section, index) => ({ ...section, materialId: `m${index}` }));
  const started = createCetActivity({ paper, purpose: "self_test", owner: "guest", id: "test", now: "2026-09-23T00:00:00Z" });
  const submitted = cetFinalize(started, paper, "manual_submit", undefined, "2026-09-23T00:05:00Z", "final");
  const after = exposureFor(paper.sections[0], paper.id, "guest", "answer_view", "after", "another", "2026-09-23T00:06:00Z");
  assert.deepEqual(cetObservedConditions(submitted, paper.sections, [after]), []);
  const during = { ...after, id: "during", occurredAt: "2026-09-23T00:03:00Z" };
  assert.deepEqual(cetObservedConditions(submitted, paper.sections, [after, during]), ["answer_view_during_test"]);
});
