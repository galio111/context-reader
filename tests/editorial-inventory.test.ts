import assert from "node:assert/strict";
import test from "node:test";
import { readAllArticleRows } from "../lib/publicArticlePagination";
import { normalizeHomepageCuration } from "../lib/homepageCurationShared";

test("a catalogue larger than the REST ceiling retains its oldest duplicate identity", async () => {
  const all = Array.from({length: 1058}, (_, i) => ({id: i}));
  const paths: string[] = [];
  const rows = await readAllArticleRows("public_articles?order=updated_at.desc,id.desc", async path => {
    paths.push(path);
    const params = new URLSearchParams(path.split("?")[1]);
    return all.slice(Number(params.get("offset")), Number(params.get("offset")) + Number(params.get("limit")));
  });
  assert.deepEqual(rows, all);
  assert.equal(paths.length, 6);
  assert.equal(rows.at(-1)?.id, 1057);
});

test("JSONB key ordering cannot discard today's or actively selected dates beyond 1000", () => {
  const dates = Object.fromEntries(Array.from({length: 1058}, (_, i) => [
    String(i).padStart(4, "0"), i < 1000 ? "2026-09-01T00:00:00Z" : "2026-10-04T00:00:00Z",
  ]));
  const first = normalizeHomepageCuration({categories: {"推荐": ["1057"]}, selectedAtById: dates});
  const jsonbRoundTrip = Object.fromEntries(Object.entries(first.selectedAtById).sort(([a], [b]) => a.localeCompare(b)));
  const next = normalizeHomepageCuration({...first, selectedAtById: jsonbRoundTrip});
  assert.equal(Object.keys(next.selectedAtById).length, 1058);
  assert.equal(next.selectedAtById["1057"], "2026-10-04T00:00:00Z");
});
