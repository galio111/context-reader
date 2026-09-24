import test from "node:test";
import assert from "node:assert/strict";
import { countDailyPublications, shanghaiDay, VisibleNoticeClock } from "../lib/dailyPublicationUpdates";
test("public selected dates deduplicate across categories, ignore invalid/unpublished and cross Shanghai midnight", () => {
  const selected = { a: "2026-09-24T16:00:00Z", b: "invalid", c: "2026-09-24T15:59:59Z", private: "2026-09-24T16:00:00Z" };
  assert.equal(countDailyPublications(["a", "a", "b", "c"], selected, "2026-09-25"), 1);
  assert.equal(countDailyPublications(["a"], selected, "2026-09-26"), 0);
  assert.equal(shanghaiDay(new Date("2026-09-24T16:00:00Z")), "2026-09-25");
});
test("notice spends two seconds only while actually visible, including multiple hidden intervals", () => {
  const clock = new VisibleNoticeClock();
  assert.equal(clock.tick(0, false), false); assert.equal(clock.tick(10000, true), false);
  assert.equal(clock.tick(10800, true), false); clock.tick(10810, false); clock.tick(50000, false);
  clock.tick(51000, true); assert.equal(clock.tick(52199, true), false); assert.equal(clock.tick(52200, true), true);
  assert.equal(clock.elapsed, 2000);
});
