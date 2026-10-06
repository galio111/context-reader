import assert from "node:assert/strict";
import test from "node:test";
import { approvedRefreshPool, isolatedPublishFailure } from "../lib/editorialRecoveryPolicy";
import type { PublicArticle } from "../types/publicArticle";
const row=(id:string,category:string,status="passed",timeliness="evergreen")=>({
  id,createdAt:new Date().toISOString(),importedArticle:{publishedTime:"2026-01-01"},
  recommendation:{sourceKind:"crawler",homepageCategory:category,editorialReview:{status},timeliness},
}) as PublicArticle;
test("reuse prior approvals for deficient culture/business and surplus approvals without re-auditing held rows",()=>{
  const rows=[row("news","时事"),row("culture","文化"),row("business","商业"),row("held","文化","held"),row("old-news","文化","passed","time-sensitive")];
  const counts={"时事":17,"科技":16,"文化":4,"商业":11};
  assert.deepEqual(approvedRefreshPool(rows,counts).map(a=>a.id),["culture","business","news"]);
  assert.deepEqual(approvedRefreshPool(rows,counts,["culture"]).map(a=>a.id),["business","news"]);
});
test("stale/duplicate candidate failures are isolated; transport/storage failures reach day failure handling",()=>{
  assert.equal(isolatedPublishFailure(Error("已有相同公开文章，不重复自动精选。")),true);
  assert.equal(isolatedPublishFailure(Error("候选内容在审核后变化，需重新审核。")),true);
  assert.equal(isolatedPublishFailure(Error("Public article storage request failed.")),false);
});
