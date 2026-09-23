import assert from "node:assert/strict";
import test from "node:test";
import { rankEditorialSources } from "../lib/editorialSourcePriority";

const business = { id: "business", topics: ["商业经济"], levelHint: "mixed", enabled: true, verification: { ok: true } };
const culture = { id: "culture", topics: ["文化历史"], levelHint: "mixed", enabled: true, verification: { ok: true } };
const secondary = { id: "secondary", topics: ["社会生活", "商业经济"], levelHint: "mixed", enabled: true, verification: { ok: true } };

test("business deficit does not spend attempts on already sufficient culture", () => {
  const counts = { "时事": 17, "科技": 17, "文化": 15, "商业": 6 };
  assert.deepEqual(rankEditorialSources([culture, secondary, business], counts, {}).map(s => s.id), ["business"]);
  assert.deepEqual(rankEditorialSources([culture, secondary, business], counts, { business: { visits: 6 } }).map(s => s.id), ["secondary"]);
});

test("when all category minimums are met, choose categories with room to reach target", () => {
  const counts = { "时事": 17, "科技": 13, "文化": 13, "商业": 13 };
  assert.deepEqual(rankEditorialSources([secondary, business, culture], counts, {}).map(s => s.id), ["business", "culture"]);
});
