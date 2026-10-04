import assert from "node:assert/strict";
import test from "node:test";
import { freshnessFailure, parsePublicationDate } from "../lib/discoveryPolicy";
const now=Date.parse("2026-10-04T07:00:00Z");
test("fresh publisher display clocks with a.m. or p.m. remain verifiable",()=>{
  for(const date of ["October 2, 2026 4:01 p.m.","October 2, 2026 9:33 a.m."]){assert.ok(Number.isFinite(parsePublicationDate(date)));assert.equal(freshnessFailure([date],true,now),"");}
});
test("normalization retains stale, future and missing source-date rejection",()=>{
  assert.match(freshnessFailure(["September 18, 2026 4:01 p.m."],true,now),/超过 7 天/);
  assert.match(freshnessFailure(["October 5, 2026 9:33 a.m."],true,now),/未来/);
  assert.match(freshnessFailure(["Unknown source date"],true,now),/缺少可靠/);
  assert.match(freshnessFailure(["September 18, 2026 4:01 p.m.","2026-10-02T12:00:00Z"],true,now),/超过 7 天/);
});
