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
  assert.deepEqual(rankEditorialSources([secondary, business, culture], counts, {}).map(s => s.id), ["secondary", "business", "culture"]);
});

test("a source with repeated off-category output is retired for the missing category", () => {
  const counts = { "时事": 17, "科技": 14, "文化": 11, "商业": 7 };
  const observed = {
    secondary: { total: 12, categories: { "时事": 12 } },
    business: { total: 8, categories: { "商业": 3, "科技": 5 } },
  };
  assert.deepEqual(rankEditorialSources([secondary, business], counts, {}, observed).map(s => s.id), ["business"]);
  assert.deepEqual(rankEditorialSources([secondary], counts, {}, observed), []);
});

test("a secondary source with proven output in a missing category remains eligible", () => {
  const counts = { "时事": 17, "科技": 14, "文化": 13, "商业": 7 };
  const observed = { secondary: { total: 10, categories: { "时事": 8, "商业": 2 } } };
  assert.deepEqual(rankEditorialSources([secondary], counts, {}, observed).map(s => s.id), ["secondary"]);
});

test("proven secondary culture supply and unread archive pages are not starved by a primary feed",()=>{
  const mixed={id:"mixed",topics:["社会生活","文化历史"],feeds:["https://example.org/feed/rss/"],levelHint:"mixed",enabled:true,verification:{ok:true}};
  const counts={"时事":17,"科技":16,"文化":4,"商业":13};
  const observed={mixed:{total:10,categories:{"文化":8}}};
  assert.deepEqual(rankEditorialSources([culture,mixed],counts,{mixed:{visits:2,empty:2}},observed).map(s=>s.id),["mixed","culture"]);
  assert.deepEqual(rankEditorialSources([mixed],counts,{mixed:{visits:6,empty:6}},observed),[]);
});
