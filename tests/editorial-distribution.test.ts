import assert from "node:assert/strict";
import test from "node:test";
import { categoryHasCapacity, distributionSatisfied } from "../lib/editorialDistribution";

test("current affairs may exceed 17 and the former total ceiling",()=>{
  assert.equal(distributionSatisfied({时事:100,科技:13,文化:15,商业:17}),true);
  assert.equal(categoryHasCapacity("时事",100),true);
  assert.equal(categoryHasCapacity("商业",17),false);
});
test("other sections retain 13–17, news its minimum, and total its minimum",()=>{
  for(const counts of [{时事:30,科技:12,文化:15,商业:17},{时事:30,科技:18,文化:15,商业:17},{时事:12,科技:17,文化:17,商业:17},{时事:13,科技:13,文化:13,商业:13}])assert.equal(distributionSatisfied(counts),false);
  assert.equal(distributionSatisfied({时事:16,科技:13,文化:13,商业:13}),true);
});
